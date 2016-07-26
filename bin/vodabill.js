// *********************************************************************************************
// *********************************************************************************************
//
// MVNO Billing
// Copyright 2016 Breato Ltd.
//
// Reproduce the Vodafone bill using billing records from a CDR file
//
// The CDR object to be processed must have these elements
//		cdr.caller
//		cdr.called
//		cdr.type		(voice|data|text|longtext|picture)
//		cdr.time		(DD/MM/YY HH:MI)
//		cdr.duration	(seconds)
//		cdr.volume		(KB)
//		cdr.details
//		cdr.charge		(pence)
//		cdr.included	(true/false)
//
// *********************************************************************************************
// *********************************************************************************************

var	fs = require('fs'),
	readline = require('readline'),
	moment = require('/usr/local/lib/node_modules/moment'),
	vsprintf = require('/usr/local/lib/node_modules/sprintf-js').vsprintf,
	config = require('/home/bf/Drive/Software/MVNO/etc/config.json'),
	vodafone = require('/home/bf/Drive/Software/MVNO/etc/vodafone.json'),
	state = {}, prms = {}, handsets = {}, recno = 0, html;

// Initialise the state
state.date = '';
state.type = '';
state.table = 'false';

// Configuration options
prms.company = {};
prms.date = {};

// Read the command line parameters
for (i=2; i<process.argv.length; i++) {
	opt = process.argv[i].split('=');
	switch (opt[0]) {
		case '-cdr':
		case '-c':
			prms.cdrfile = opt[1];
			break;
		case '-org':
		case '-o':
			prms.company.name = opt[1];
			break;
		case '-month':
		case '-m':
			prms.date.month = opt[1];
			break;
		case '-year':
		case '-y':
			prms.date.year = opt[1];
			break;
	}
}

// All options are mandatory
if (prms.cdrfile === undefined ||
	prms.company.name === undefined ||
	prms.date.month === undefined ||
	prms.date.year === undefined) {
	console.log("Invalid argument(s) specified. The following arguments must be provided:");
	console.log("\t-c|cdr    Full path and name of CDR file");
	console.log("\t-o|org    Name of company");
	console.log("\t-m|month  Month the CDRs relate to, in 'Mon' format");
	console.log("\t-y|year   Year the CDRs relate to, in 'YYMM' format");
	return;
}

// Check date
prms.date.full = prms.date.month + ' ' + prms.date.year;
prms.date.yymm = moment(prms.date.full, 'MMM YYYY').format('YYMM');

// Company code (lower case, no spaces)
prms.company.code = prms.company.name.toLowerCase();
prms.company.code = prms.company.code.replace(/ /, '');

// Read company configuration data from a file
read_company(config.system.data + '/' + prms.company.code + '.json');



// ---------------------------------------------------------------------------------------------
// Summary of handset usage for the company
// ---------------------------------------------------------------------------------------------
function company_summary () {
	var packages, n, index, data = [], fmt = [], i, str, vchg, vexc, dchg, dexc, schg, col = {};

	// Vodafone packages
	packages = Object.keys(vodafone.packages);

	// Create HTML page linking all handset reports
	index = '<html><head>';
	index += '<title>' + prms.company.name + ' Summary for ' + prms.date.full + '</title>';
	index += '<link rel="stylesheet" href="' + config.system.css + '">';
	index += '</head><body>';
	index += '<h1>' + prms.company.name + ' Vodafone Bill for ' + prms.date.full + '</h1>';
	index += '<h2>Handset Summary</h2><table>';

	// Table heading
	fmt = ["S15-T","S5-T"];
	data = ['Handset','Vodafone Bill'];
	for (n=0; n<packages.length; n++) {
		fmt.push("S10-T-R");
		data.push(vodafone.packages[packages[n]].name);
	}
	fmt = fmt.concat(["S10-T-R","S10-T-R","S10-T-R","S10-T-R","S10-T-R","S10-T-R"]);
	data = data.concat(['Total Services','Voice Charges','Voice Due','Data Charges','Data Due','Total Due']);
	index += show_record(fmt, data);

	// Initialise column totals
	col['stot'] = 0;
	col['vchg'] = 0;
	col['vexc'] = 0;
	col['dchg'] = 0;
	col['dexc'] = 0;
	col['tot'] = 0;

	// Create output for each handset (in handset number order)
	for (i=0; i<handsets.seq.length; i++) {
		// Initialise standing charge total
		col['schg'] = 0;
		data = [];

		// Handset record, only show link if there is data
		fmt = ["S15","S5"];
		data.push(handsets.seq[i]);
		if ((handsets[handsets.seq[i]].data.chg + handsets[handsets.seq[i]].voice.chg) > 0) {
			str = '<a href="' + handsets.seq[i] + '.html">View</a>';
			str += ' <a href="' + handsets.seq[i] + '_us.html">3D</a>';
			str += ' <a href="' + handsets.seq[i] + '_ub.html">2D</a>';
			data.push(str);
		}
		else {
			data.push('');
		}

		// Standing charges
		for (n=0; n<packages.length; n++) {
			fmt.push("F10.2-R-£");
			schg = nvl(handsets[handsets.seq[i]].standing[packages[n]]);
			data.push(schg);
			if (col[packages[n]] === undefined) { col[packages[n]] = 0; }
			col[packages[n]] += schg;
			col['schg'] += schg;
		}

		// Usage charges
		vchg = nvl(handsets[handsets.seq[i]].voice.chg);
		vexc = nvl(handsets[handsets.seq[i]].voice.exc);
		dchg = nvl(handsets[handsets.seq[i]].data.chg);
		dexc = nvl(handsets[handsets.seq[i]].data.exc);
		data.push(col['schg']);
		data.push(vchg);
		data.push(vexc);
		data.push(dchg);
		data.push(dexc);
		data.push((vexc + dexc + col['schg']));
		fmt.push("F10.2-R-B-£","F10.2-R-£","F10.2-R-B-£","F10.2-R-£","F10.2-R-B-£","F10.2-R-B-£");

		// Increment column totals
		col['stot'] += col['schg'];
		col['vchg'] += vchg;
		col['vexc'] += vexc;
		col['dchg'] += dchg;
		col['dexc'] += dexc;
		col['tot'] += vexc + dexc + col['schg'];

		// Generate row
		index += show_record(fmt, data);
	}

	// Generate total row
	fmt = ["S15-B","S1-B"];
	data = ['Total',''];
	for (n=0; n<packages.length; n++) {
		fmt.push("F10.2-R-B-£");
		data.push(col[packages[n]]);
	}
	data.push(col['stot']);
	data.push(col['vchg']);
	data.push(col['vexc']);
	data.push(col['dchg']);
	data.push(col['dexc']);
	data.push(col['tot']);
	fmt.push("F10.2-R-B-£","F10.2-R-B-£","F10.2-R-B-£","F10.2-R-B-£","F10.2-R-B-£","F10.2-R-B-£");
	index += show_record(fmt, data);

	// Close the HTML link page and write to file
	index += '</table></body></html>';
	write_file('data', 'summary.html', index);
}



// ---------------------------------------------------------------------------------------------
// Format the number of seconds into a string '0h 0m 0s'
//
// Argument 1 : Number of seconds
// ---------------------------------------------------------------------------------------------
function format_duration (secs) {
	var hr, mi, sc, str = '';
	hr = parseInt(secs / 3600);
	mi = parseInt((secs - (hr * 3600)) / 60);
	sc = secs - (hr * 3600) - (mi * 60);
	str += (hr > 0) ? hr + 'h ' : '';
	str += mi + 'm ';
	str += sc + 's';
	return str;
}



// ---------------------------------------------------------------------------------------------
// Format the data volume as MB, then add decimal place
//
// Argument 1 : Number of KB
// ---------------------------------------------------------------------------------------------
function format_volume (kb) {
	var str;
	if (kb >= 1000000) { str = parseInt(kb / 1000) + 'GB'; }
	else if (kb >= 1000) { str = parseInt(kb) + 'MB'; }
	else { str = parseInt(kb * 1000) + 'KB'; }
	// Add decimal place
	return str.substring(0, str.length-5) + '.' + str.substring(str.length-5);
}



// ---------------------------------------------------------------------------------------------
// Add a CDR to the handset report
//
// Argument 1 : Call data record object
// Argument 2 : Current CDR number
// Argument 3 : Last CDR number
// ---------------------------------------------------------------------------------------------
function handset_cdr (cdr, current, last) {
	var head = [], data = [], datetime = [], dom, vpn;

	// Handset header and voice header
	if (current === 0) {
		html += show_record(["S15-H1"], ["Itemisation for " + cdr.caller + " for " + prms.date.full + "\n"]);
		html += show_record(["S10-H2"], ["Calls\n"]);

		// CDR record table header
		head = ['Time','Number or description','Details','Normal','You pay'];
		html += show_record(["S8-T","S40-T","S10-T","S10-T-R","S10-T-R"], head);
	}

	// CDR type header
	if (state.type !== cdr.type) {
		// If last type is voice and current is a data record
		if (state.type === 'voice' && cdr.type !== 'voice') {
			// Voice totals
			handset_totals('voice', cdr.caller);

			// Header for data
			html += show_record(["S30-H2"], ["\nMessaging, Mobile Internet\n"]);

			// CDR record table header
			head = ['Time','Number or description','Details','Normal','You pay'];
			html += show_record(["S8-T","S40-T","S10-T","S10-T-R","S10-T-R"], head);
		}

		// Save data type and reset data variable to print the CDR
		state.type = cdr.type;
	}

	// Show date when it changes
	datetime = cdr.time.split(' ');
	if (state.date !== datetime[0]) {
		state.date = datetime[0];
		html += show_record(["S10-B"], [moment(datetime[0],'DD/MM/YY').format('ddd DD MMMM')]);
	}

	// Show voice records
	if (cdr.type === 'voice') {
		// Data record
		data.push(datetime[1]);
		data.push(cdr.called + ' ' + cdr.details);
		// Call duration
		data.push(format_duration(cdr.duration));
		// Charge
		data.push(parseFloat(cdr.charge / 100));
		// Charge if not in bundle
		data.push((cdr.included === 'true') ? 0 : parseFloat(cdr.charge / 100));
		// Included in bundle flag
		data.push((cdr.included === 'true' && cdr.charge > 0) ? 'Y' : '');
		html += show_record(["S8","S40","S10","F10.3-R-£","F10.3-R-£","S3"], data);

		// Increment running totals
		dom = parseInt(moment(datetime[0],'DD/MM/YY').format('DD'));
		vpn = (cdr.details === 'VPN') ? 1 : 0;
		handset_inc_total(cdr.type, cdr.caller, {'chg':data[3], 'act':data[4], 'who':cdr.called, 'dom':dom, 'vpn':vpn, 'dur':cdr.duration});
	}
	// Data records
	else {
		// Data record
		data.push(datetime[1]);
		// Called number or 'Mobile internet' if data
		data.push((cdr.type === 'data') ? 'Mobile internet' : cdr.called + ' ' + cdr.details);
		// Data volume, empty if anything else
		if (cdr.volume) {
			data.push(format_volume(cdr.volume));
		}
		else {
			data.push('');
		}
		// Charge
		data.push(parseFloat(cdr.charge / 100));
		// Charge if not in bundle
		data.push((cdr.included === 'true') ? 0 : parseFloat(cdr.charge / 100));
		// Included in bundle flag
		data.push((cdr.included === 'true') ? 'Y' : '');
		html += show_record(["S8","S40","S10","F10.3-R-£","F10.3-R-£","S3"], data);

		// Increment running totals
		handset_inc_total(cdr.type, cdr.caller, {'chg':data[3], 'act':data[4], 'vol':cdr.volume});
	}

	// Handset data totals
	if (current === last) {
		handset_totals('data', cdr.caller);
	}
}



// ---------------------------------------------------------------------------------------------
// Increment the running totals for the handset
//
// Argument 1 : Call data record type
// Argument 2 : Handset number
// Argument 3 : Data object
// ---------------------------------------------------------------------------------------------
function handset_inc_total (type, caller, data) {
	// Voice specific totals
	if (type === 'voice') {
		handsets[caller].voice.tot += 1;
		handsets[caller].voice.totdur += data.dur;
		handsets[caller].voice.chg += data.chg;
		handsets[caller].voice.exc += data.act;
		handsets[caller].voice.vpn += data.vpn;
		handsets[caller].voice.vpndur += (data.vpn) ? data.dur : 0;

		// Data for 2D bubble graphs
		if (handsets[caller].voice.bubble[data.who] === undefined) {
			handsets[caller].voice.bubble[data.who] = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
		}
		handsets[caller].voice.bubble[data.who][data.dom-1] += 1;
//		handsets[caller].voice.bubble[data.dom-1] += 1;

		// Data for 3D surface graphs
		if (handsets[caller].voice.surface[data.who] === undefined) {
			handsets[caller].voice.surface[data.who] = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
		}
		handsets[caller].voice.surface[data.who][data.dom-1] += 1;
	}
	// Data specific totals (text, long text, video, picture and mobile data)
	else {
		handsets[caller].data.tot += 1;
		handsets[caller].data.dat += (type === 'data') ? 1 : 0;
		handsets[caller].data.dattot += (type === 'data') ? data.vol : 0;
		handsets[caller].data.txt += (type === 'text') ? 1 : 0;
		handsets[caller].data.lng += (type === 'longtext') ? 1 : 0;
		handsets[caller].data.pic += (type === 'picture') ? 1 : 0;
		handsets[caller].data.vid += (type === 'video') ? 1 : 0;
		handsets[caller].data.chg += data.chg;
		handsets[caller].data.exc += data.act;
	}
}



// ---------------------------------------------------------------------------------------------
// Report of CDRs for each handset
//
// Argument 1 : Handset
// ---------------------------------------------------------------------------------------------
function handset_report (handset) {
	var sorted, i, arr, cdr;

	// Initialise the HTML output
	html = '<html><head><title>Bill for ';
	html += handset;
	html += '</title><link rel="stylesheet" href="' + config.system.css + '"></head><body>';

	// Sort CDRs by date time for this handset
	sorted = handsets[handset].unsorted.sort();

	// Process CDRs for this handset
	for (i=0; i<sorted.length; i++) {
		arr = sorted[i].split('-');
		cdr = handsets[handset].cdr[parseInt(arr[2])];
		if (cdr) {
			handset_cdr(cdr, i, sorted.length-1);
		}
	}

	// Close the HTML output and write to file
	html += '</body></html>';
	write_file('data', handset + '.html', html);
}



// ---------------------------------------------------------------------------------------------
// Show usage totals for a handset
//
// Argument 1 : Voice or data
// Argument 2 : Handset
// ---------------------------------------------------------------------------------------------
function handset_totals (type, handset) {
	var str, dur, data;

	// Total header
	html += show_record(["S10-B"], ['Totals']);

	// Voice sub-totals
	if (type === 'voice') {
		str = "Total of " + handsets[handset].voice.vpn + " calls inside VPN";
		dur = format_duration(handsets[handset].voice.vpndur);
		data = [str, '', dur, 0, 0];
		html += show_record(["S49","S10","S1","F10.3-R-£","F10.3-R-£"], data);

		str = "Total of " + (handsets[handset].voice.tot - handsets[handset].voice.vpn) + " other calls";
		dur = format_duration(handsets[handset].voice.totdur - handsets[handset].voice.vpndur);
		data = [str, '', dur, handsets[handset].voice.chg, handsets[handset].voice.exc];
		html += show_record(["S49","S10","S1","F10.3-R-£","F10.3-R-£"], data);

		str = "Total of " + handsets[handset].voice.tot + " calls";
		dur = format_duration(handsets[handset].voice.totdur);
		data = [str, '', dur, handsets[handset].voice.chg, handsets[handset].voice.exc];
		html += show_record(["S49","S10","S1","F10.3-R-£","F10.3-R-£"], data);
	}

	// Data sub-totals and handset total
	if (type === 'data') {
		// Breakdown of data types
		if (handsets[handset].data.dat > 0) {
			data = [handsets[handset].data.dat + ' mobile internet charges', '', format_volume(handsets[handset].data.dattot), '', ''];
			html += show_record(["S60","S1","S10","S1","S1"], data);
		}
		if (handsets[handset].data.txt > 0) {
			data = [handsets[handset].data.txt + ' texts', '', '', '', ''];
			html += show_record(["S60","S1","S1","S1","S1"], data);
		}
		if (handsets[handset].data.lng > 0) {
			data = [handsets[handset].data.lng + ' long texts', '', '', '', ''];
			html += show_record(["S60","S1","S1","S1","S1"], data);
		}
		if (handsets[handset].data.pic > 0) {
			data = [handsets[handset].data.pic + ' pictures', '', '', '', ''];
			html += show_record(["S60","S1","S1","S1","S1"], data);
		}
		if (handsets[handset].data.vid > 0) {
			data = [handsets[handset].data.vid + ' videos', '', '', '', ''];
			html += show_record(["S60","S1","S1","S1","S1"], data);
		}

		// Data usage total
		data = ['Data usage total', '', '', handsets[handset].data.chg, handsets[handset].data.exc];
		html += show_record(["S60s","S1","S1","F10.3-R-£","F10.3-R-£"], data);

		// Handset total and some new lines
		str = "Total voice and data usage";
		data = [str, '', '', '', (handsets[handset].voice.exc + handsets[handset].data.exc)];
		html += show_record(["S60-B","S1-B","S1-B","S1-B","F21.3-R-£-B"], data);
	}
}



// ---------------------------------------------------------------------------------------------
// Create 2D bubble graph of usage
//
// Argument 1 : Handset number
// ---------------------------------------------------------------------------------------------
function handset_usage_bubble (handset) {
	var index, data, called, i, dom = [], x = [], y = [], size = [], text = [], n,
		gph = config.graphs.usageBubble;

	// Create HTML page
	index = '<html><head>';
	index += '<script src="https://cdn.plot.ly/plotly-latest.min.js"></script>';
	index += '</head><body>';
	// Plotly chart will be drawn inside this DIV
	index += '<div id="plotlyDiv" style="width:480px; height:400px;"></div>';
	index += '<script>';

	// Data for graph
	index += 'var data = [ ';
	data = handsets[handset].voice.bubble;
	called = Object.keys(data).sort();

	// Day of month
	for (i=1; i<=31; i++) {
		dom.push('"' + moment((i + ' ' + prms.date.full), 'DD MMM YYYY').format('YYYY-MM-DD') + '"');
	}

	// Build the data arrays
	for (i=0; i<called.length; i++) {
		x = [];
		y = [];
		size = [];
		text = [];
		for (n=0; n<dom.length; n++) {
			if (data[called[i]][n] > 0) {
				x.push(dom[n]);
				y.push(i+1);
				size.push(10 * data[called[i]][n]);
				text.push('"' + data[called[i]][n] + ' Call' + ((data[called[i]][n] > 1) ? 's' : '') + ' to ' + called[i] + '"');
			}
		}
		index += '{ name: "",';
		index += 'x: [' + x.join() + '],';
		index += 'y: [' + y.join() + '],';
		index += 'text: [' + text.join() + '],';
		index += 'mode: "markers",';
		index += 'marker: {';
		index += 'size: [' + size.join() + '] } },';
	}

	// Remove last comma and close array
	index = index.replace(/,$/, '') + ' ]; ';

	// Graph layout
	index += 'var layout = {';
	index += 'title: "Calls made by ' + handset + ' during ' + prms.date.full + '",';
	index += 'showlegend: false, width: ' + gph.width + ', height: ' + gph.height + ', ';
	index += 'xaxis: {title: "' + gph.legend.x + '", showline: ' + gph.gridline.x + ', showticklabels: true, ticklen: 8, type: "date"}, ';
	index += 'yaxis: {title: "' + gph.legend.y + '", showline: ' + gph.gridline.y + ', showticklabels: false, zeroline: false} ';
	index += '};';

	// Close the graph
	index += 'Plotly.newPlot("plotlyDiv", data, layout);';
	index += '</script></body></html>';

	// Write the graph to a file
	write_file('data', handset + '_ub.html', index);
}



// ---------------------------------------------------------------------------------------------
// Create 3D surface graph of usage
//
// Argument 1 : Handset number
// ---------------------------------------------------------------------------------------------
function handset_usage_surface (handset) {
	var index, data, called, i, dom = [], caller = [],
		gph = config.graphs.usageSurface;

	// Create HTML page
	index = '<html><head>';
	index += '<script src="https://cdn.plot.ly/plotly-latest.min.js"></script>';
	index += '</head><body>';
	// Plotly chart will be drawn inside this DIV
	index += '<div id="plotlyDiv" style="width:480px; height:400px;"></div>';
	index += '<script>';

	// Data for graph
	index += 'var data = [ {';
	data = handsets[handset].voice.surface;
	called = Object.keys(data).sort();

	// X-axis : Day of month
	for (i=1; i<=31; i++) {
//		dom.push('"' + moment((i + ' ' + prms.date.full), 'DD MMM YYYY').format('DD ddd') + '"');
		dom.push('"' + moment((i + ' ' + prms.date.full), 'DD MMM YYYY').format('YYYY-MM-DD') + '"');
	}
	index += 'x: [' + dom.join() + '],';

	// Y-axis : Caller number
	for (i=0; i<called.length; i++) {
		caller.push('"[' + i + '] ' + called[i] + '"');
//		caller.push('"' + called[n] + '"');
	}
	index += 'y: [' + caller.join() + '],';

	// Z-axis
	index += 'z: [';
	for (i=0; i<called.length; i++) {
		index += '[' + data[called[i]].join() + ']';
		index += (i<called.length-1) ? ',' : '';
	}
	index += '],';

	// Graph layout
	index += 'type: "surface"';
	index += '} ];';
	index += 'var layout = {';
	index += 'title: "Calls made by ' + handset + ' during ' + prms.date.full + '",';
	index += 'autosize: true, width: ' + gph.width + ', height: ' + gph.height + ', ';
	index += 'margin: { l: ' + gph.left + ', r: ' + gph.right + ', b: ' + gph.bottom + ', t: ' + gph.top + ' }, ';
	index += 'scene: { xaxis: {title: "' + gph.legend.x + '", showline: ' + gph.gridline.x + ', showspikes: false, ticklen: 8, type: "date"}, ';
	index += '		   yaxis: {title: "' + gph.legend.y + '", showline: ' + gph.gridline.y + ', showspikes: false, showticklabels: false}, ';
	index += '		   zaxis: {title: "' + gph.legend.z + '", showline: ' + gph.gridline.z + ', showspikes: false, ticklen: 8} }';
	index += '};';

	// Close the graph
	index += 'Plotly.newPlot("plotlyDiv", data, layout);';
	index += '</script></body></html>';

	// Write the graph to a file
	write_file('data', handset + '_us.html', index);
}



// ---------------------------------------------------------------------------------------------
// Build the index page
// ---------------------------------------------------------------------------------------------
function index_page () {
	var index, i, handset;

	// Create HTML page for company linking all months ???????????????????????????????????????????????????? LIST ALL MONTHS NOT JUST 1
	index = '<html><head>';
	index += '<title>Vodafone Bills</title>';
	index += '<link rel="stylesheet" href="' + config.system.css + '">';
	index += '</head><body>';
	index += '<h1>' + prms.company.name + ' Vodafone Bill</h1>';
	index += '<h2><a href="' + prms.date.yymm + '/summary.html">' + prms.date.full + '</a></h2>';

	// Close the HTML link page and write to file
	index += '</ol></body></html>';
	write_file('index', 'index.html', index);

	// Handset reports
	for (i=0; i<handsets.seq.length; i++) {
		handset = handsets.seq[i];

		// Create usage report for each handset and create handset totals
		handset_report(handset);

		// Create 3D surface graph of usage
		handset_usage_surface(handset);

		// Create 2D bubble graph of usage
		handset_usage_bubble(handset);
	}

	// Summary of handset usage for the company
	company_summary();
}



// ---------------------------------------------------------------------------------------------
// Start processing company data
//
// Argument 1 : Object holding organisation data
// ---------------------------------------------------------------------------------------------
function initialise (data) {
	var org = {}, i, caller, n, packages, arr;

	// Create a unique ordered list of handsets
	org = JSON.parse(data.toString());
	handsets.seq = Object.keys(org.handsets).sort();

	// Initialise data for each handset
	for (i=0; i<handsets.seq.length; i++) {
		caller = handsets.seq[i];

		// Add usage containers
		if (handsets[caller] === undefined) {
			handsets[caller] = {};
			handsets[caller].cdr = [];
			handsets[caller].unsorted = [];
			handsets[caller].data = {};
			handsets[caller].data.tot = 0;
			handsets[caller].data.dat = 0;
			handsets[caller].data.dattot = 0;
			handsets[caller].data.txt = 0;
			handsets[caller].data.lng = 0;
			handsets[caller].data.pic = 0;
			handsets[caller].data.vid = 0;
			handsets[caller].data.chg = 0;
			handsets[caller].data.exc = 0;
			handsets[caller].voice = {};
			handsets[caller].voice.tot = 0;
			handsets[caller].voice.totdur = 0;
			handsets[caller].voice.vpn = 0;
			handsets[caller].voice.vpndur = 0;
			handsets[caller].voice.chg = 0;
			handsets[caller].voice.exc = 0;
			handsets[caller].voice.bubble = {};
			handsets[caller].voice.surface = {};
			handsets[caller].standing = {};
		}

		// Load standing charges
		packages = org.handsets[caller];
		for (n=0; n<packages.length; n++) {
			arr = packages[n].split('-');
			handsets[caller].standing[arr[0]] = vodafone.packages[arr[0]].rates[arr[1]];
		}
	}

	// Load the CDR file
	load_cdrs();
}



// ---------------------------------------------------------------------------------------------
// Load all the CDRs from file and store in a the 'handsets' object
// ---------------------------------------------------------------------------------------------
function load_cdrs () {
	var cdr;

	// Process the billing data in the CDR file line by line
	cdr = readline.createInterface({
		input: fs.createReadStream(prms.cdrfile)
	});

	// Read billing records from CDR file and process
	cdr.on('line', function (line) {
		var json, num, typ;

		// Convert JSON to object and add the record number
		json = JSON.parse(line);

		// Increment the record number
		recno++;

		// Add CDR to handset
		handsets[json.caller].cdr[recno] = json;

		// Add a unique index for sorting - {call type}-{date/time}-00000nn
		typ = (json.type === 'voice') ? '1' : '2';
		num = '000000' + recno;
		handsets[json.caller].unsorted.push(typ + '-' + json.time + '-' + num.slice(-7));
	});

	// Close the CDR file and process the CDRs for each handset
	cdr.on('close', function () {
		index_page();
	});
}



// ---------------------------------------------------------------------------------------------
// Parse a charge to be included in the report
//
// Argument 1 : Charge in pence
//
// If charge is defined return the value
// If value is not defined, return 0
// ---------------------------------------------------------------------------------------------
function nvl (value) {
	return (value === undefined) ? 0 : parseFloat(value);
}



// ---------------------------------------------------------------------------------------------
// Read company configuration data from a file
//
// Argument 1 : Name of file
// ---------------------------------------------------------------------------------------------
function read_company (file) {
	fs.readFile(file, function(error, data) {
		if (error) {
			console.error("Error reading [" + file + "]: " + error.message);
		}
		// Start processing company data
		initialise(data);
	});
}



// ---------------------------------------------------------------------------------------------
// Parse a charge to be included in the report
//
// Argument 1 : Format array with 1 element per column
//				["F10.2","F10.2-R-B-£","S12","S12-B","S12-T","S12-T-R","S12-H1"]
//				Mandatory
//					Fnn.nn		= Floating point number
//					Snn			= String with width
//				Optional
//					-H1			= Heading 1 style
//					-H2			= Heading 2 style
//					-H3			= Heading 3 style
//					-B			= Table cell character bold style, background fill
//					-T			= Table cell character bold style, background fill, larger font
//					-R			= Table cell right align
//					-£			= Add £ sign before number
// Argument 2 : Data array with 1 element per column
// ---------------------------------------------------------------------------------------------
function show_record (format, data) {
	var i, str, td, fmt, res, arr, result = '';

	// Find name of 1st element
	str = format[0].replace(/^.+-/, '');

	// If H1, H2 or H3
	if (str.search(/^h[1-3]/i) === 0) {
		// If last element was a table, add a table close element
		if (state.table === 'true') {
			result += '</table>';
			state.table = 'false';
		}
		// Add element
		result += '<' + str.toLowerCase() + '>' + data[0] + '</' + str.toLowerCase() + '>';
	}
	// Table row
	else {
		// If last element was not a table, add a table element
		if (state.table === 'false') {
			result += '<table>';
			state.table = 'true';
		}
		result += '<tr>';
		for (i=0; i<format.length; i++) {
			fmt = format[i].toUpperCase();
			// Open table cell
			result += '<td';

			// Add class
			result += (fmt.search(/-B/) > -1) ? ' class="bold"' : '';
			result += (fmt.search(/-T/) > -1) ? ' class="head"' : '';

			// Add right align
			result += (fmt.search(/-R/) > -1) ? ' align="right"' : '';

			// Close table cell
			result += '>';

			// Force data to char and remove newline chars
			str = data[i].toString();
			str = str.replace(/\n/g, '');

			// Add data to cell - float
			if (fmt.search(/^F/) === 0) {
				// If no decimal point, add one
				str += (str.search(/\./) === -1) ? '.' : '';

				// Add a £ sign
				result += (fmt.search(/-£/) > -1) ? '&pound;' : '';

				// Truncate to specified DPs (pad with zeros first)
				str += '000000000';
				res = fmt.replace(/[A-Z\-]/g, '');
				arr = res.split('.');
				result += str.substring(0, str.search(/\./)+parseInt(arr[1])+1);
			}
			// Add data to cell - string
			else {
				result += str;
			}

			// Close the cell
			result += '</td>';
		}
		result += '</tr>';
	}

	// Return formatted string
	return result;
}



// ---------------------------------------------------------------------------------------------
// Write data to a file
//
// Argument 1 : Type of file (index or company data)
// Argument 2 : Name of file
// Argument 3 : Data to be saved
// ---------------------------------------------------------------------------------------------
function write_file (type, name, data) {
	var file = config.system.root + '/' + prms.company.code + '/';
	file += (type === 'data') ? prms.date.yymm + '/' : '';
	file += name;

	fs.writeFile(file, data, function(error) {
		if (error) {
			console.error("Error writing to [" + file + "]: " + error.message);
		}
	});
}
