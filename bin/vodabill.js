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
// Build up usage stats for each handset
//
// Argument 1 : Call data record object
// Argument 2 : Current CDR number
// Argument 3 : Last CDR number
// ---------------------------------------------------------------------------------------------
function create_record (cdr, current, last) {
	var head = [], data = [], datetime = [], str = '', hr, mi, sc;

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
			create_totals('voice', cdr.caller);

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
		hr = parseInt(cdr.duration / 3600);
		mi = parseInt((cdr.duration - (hr * 3600)) / 60);
		sc = cdr.duration - (hr * 3600) - (mi * 60);
		str += (hr > 0) ? hr + 'h ' : '';
		str += mi + 'm ';
		str += sc + 's';
		data.push(str);
		// Charge
		data.push(parseFloat(cdr.charge / 100));
		// Charge if not in bundle
		data.push((cdr.included === 'true') ? 0 : parseFloat(cdr.charge / 100));
		// Included in bundle flag
		data.push((cdr.included === 'true' && cdr.charge > 0) ? 'Y' : '');
		html += show_record(["S8","S40","S10","F10.3-R-£","F10.3-R-£","S3"], data);

		// Increment counters
		handsets[cdr.caller].voice.vpn += (cdr.details === 'VPN') ? 1 : 0;
		handsets[cdr.caller].voice.tot += 1;
		handsets[cdr.caller].voice.chg += data[3];
		handsets[cdr.caller].voice.exc += data[4];
	}
	// Data records
	else {
		// Data record
		data.push(datetime[1]);
		// Called number or 'Mobile internet' if data
		data.push((cdr.type === 'data') ? 'Mobile internet' : cdr.called + ' ' + cdr.details);
		// Data volume, empty if anything else
		if (cdr.volume) {
			// Express as MB, then add decimal place
			if (cdr.volume >= 1000000) { str = parseInt(cdr.volume / 1000) + 'GB'; }
			else if (cdr.volume >= 1000) { str = parseInt(cdr.volume) + 'MB'; }
			else { str = parseInt(cdr.volume * 1000) + 'KB'; }
			// Add decimal place
			str = str.substring(0, str.length-5) + '.' + str.substring(str.length-5);
			data.push(str);
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

		// Increment counters
		handsets[cdr.caller].data.tot += 1;
		handsets[cdr.caller].data.dat += (cdr.type === 'data') ? 1 : 0;
		handsets[cdr.caller].data.txt += (cdr.type === 'text') ? 1 : 0;
		handsets[cdr.caller].data.lng += (cdr.type === 'longtext') ? 1 : 0;
		handsets[cdr.caller].data.pic += (cdr.type === 'picture') ? 1 : 0;
		handsets[cdr.caller].data.vid += (cdr.type === 'video') ? 1 : 0;
		handsets[cdr.caller].data.chg += data[3];
		handsets[cdr.caller].data.exc += data[4];
	}

	// Handset data totals
	if (current === last) {
		create_totals('data', cdr.caller);
	}
}



// ---------------------------------------------------------------------------------------------
// Show usage totals for a handset
//
// Argument 1 : Voice or data
// Argument 2 : Handset
// ---------------------------------------------------------------------------------------------
function create_totals (type, handset) {
	var str, data;

	// Voice sub-totals
	if (type === 'voice') {
		str = "Total of " + handsets[handset].voice.vpn + " calls inside VPN";
		data = [str, '', '', 0, 0];
		html += show_record(["S49","S10","S1","F10.3-R-£","F10.3-R-£"], data);

		str = "Total of " + (handsets[handset].voice.tot - handsets[handset].voice.vpn) + " other calls";
		data = [str, '', '', handsets[handset].voice.chg, handsets[handset].voice.exc];
		html += show_record(["S49","S10","S1","F10.3-R-£","F10.3-R-£"], data);

		str = "Total of " + handsets[handset].voice.tot + " calls";
		data = [str, '', '', handsets[handset].voice.chg, handsets[handset].voice.exc];
		html += show_record(["S49","S10","S1","F10.3-R-£","F10.3-R-£"], data);
	}

	// Data sub-totals and handset total
	if (type === 'data') {
		// Breakdown of data types
		if (handsets[handset].data.dat > 0) {
			data = [handsets[handset].data.dat + ' mobile internet charges', '', '', '', ''];
			html += show_record(["S60s","S1","S1","S1","S1"], data);
		}
		if (handsets[handset].data.txt > 0) {
			data = [handsets[handset].data.txt + ' texts', '', '', '', ''];
			html += show_record(["S60s","S1","S1","S1","S1"], data);
		}
		if (handsets[handset].data.lng > 0) {
			data = [handsets[handset].data.lng + ' long texts', '', '', '', ''];
			html += show_record(["S60s","S1","S1","S1","S1"], data);
		}
		if (handsets[handset].data.pic > 0) {
			data = [handsets[handset].data.pic + ' pictures', '', '', '', ''];
			html += show_record(["S60s","S1","S1","S1","S1"], data);
		}
		if (handsets[handset].data.vid > 0) {
			data = [handsets[handset].data.vid + ' videos', '', '', '', ''];
			html += show_record(["S60s","S1","S1","S1","S1"], data);
		}

		// Data usage total
		data = ['Data usage total', '', '', handsets[handset].data.chg, handsets[handset].data.exc];
		html += show_record(["S60s","S1","S1","F10.3-R-£","F10.3-R-£"], data);

		// Handset total and some new lines
		str = "Total usage for " + handset;
		data = [str, '', '', '', (handsets[handset].voice.exc + handsets[handset].data.exc)];
		html += show_record(["S60","S1","S1","S1","F21.3-R-£"], data);
		html += show_record(["S10-R"], ["\n\n\n"]);
	}
}



// ---------------------------------------------------------------------------------------------
// Start processing company data
//
// Argument 1 : Object holding organisation data
// ---------------------------------------------------------------------------------------------
function initialise (data) {
	var org = {}, i, n, packages, arr;

	// Create a unique ordered list of handsets
	org = JSON.parse(data.toString());
	handsets.seq = Object.keys(org.handsets).sort();

	// Initialise data for each handset
	for (i=0; i<handsets.seq.length; i++) {
		// Add usage containers
		if (handsets[handsets.seq[i]] === undefined) {
			handsets[handsets.seq[i]] = {};
			handsets[handsets.seq[i]].cdr = [];
			handsets[handsets.seq[i]].unsorted = [];
			handsets[handsets.seq[i]].data = {};
			handsets[handsets.seq[i]].data.tot = 0;
			handsets[handsets.seq[i]].data.dat = 0;
			handsets[handsets.seq[i]].data.txt = 0;
			handsets[handsets.seq[i]].data.lng = 0;
			handsets[handsets.seq[i]].data.pic = 0;
			handsets[handsets.seq[i]].data.vid = 0;
			handsets[handsets.seq[i]].data.chg = 0;
			handsets[handsets.seq[i]].data.exc = 0;
			handsets[handsets.seq[i]].voice = {};
			handsets[handsets.seq[i]].voice.tot = 0;
			handsets[handsets.seq[i]].voice.vpn = 0;
			handsets[handsets.seq[i]].voice.chg = 0;
			handsets[handsets.seq[i]].voice.exc = 0;
			handsets[handsets.seq[i]].standing = {};
		}

		// Load standing charges
		packages = org.handsets[handsets.seq[i]];
		for (n=0; n<packages.length; n++) {
			arr = packages[n].split('-');
			handsets[handsets.seq[i]].standing[arr[0]] = vodafone.packages[arr[0]].rates[arr[1]];
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

		// Add a unique index for sorting (by call type and date/time)
		typ = (json.type === 'voice') ? '1' : '2';
		num = '000000' + recno;
		handsets[json.caller].unsorted.push(typ + '-' + json.time + '-' + num.slice(-7));
	});

	// Close the CDR file and process the CDRs for each handset
	cdr.on('close', function () {
		process_cdrs();
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
// Process CDRs for each handset
// ---------------------------------------------------------------------------------------------
function process_cdrs () {
	var i, index, file;

	// Create HTML page linking all handset reports
	index = '<html><head>';
	index += '<title>' + prms.company.name + ' Vodafone Bill for ' + prms.date.full + '</title>';
	index += '<link rel="stylesheet" href="' + config.system.css + '">';
	index += '</head><body>';
	index += '<h1>' + prms.company.name + ' Vodafone Bill for ' + prms.date.full + '</h1>';
	index += '<h2><a href="summary.html">Handset Summary</a></h2>';
	index += '<h2>Handset Bills</h2><ol>';

	// Create output for each handset (in handset number order)
	for (i=0; i<handsets.seq.length; i++) {
		report_handset(handsets.seq[i]);

		// Create HTML page linking all handset reports
		index += '<li><a href="' + handsets.seq[i] + '.html">' + handsets.seq[i] + '</a></li>';
	}

	// Close the HTML link page and write to file
	index += '</ol></body></html>';
	file = config.system.root + '/' + prms.company.code + '/index.html';
	write_file (file, index);

	// Summary of handset usage
	report_summary();
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
// Report of CDRs for each handset
// ---------------------------------------------------------------------------------------------
function report_handset (handset) {
	var sorted, n, arr, cdr, file;

	// Initialise the HTML output
	html = '<html><head><title>Bill for ';
	html += handset;
	html += '</title><link rel="stylesheet" href="' + config.system.css + '"></head><body>';

	// Sort CDRs by date time for this handset
	sorted = handsets[handset].unsorted.sort();

	// Process CDRs for this handset
	for (n=0; n<sorted.length; n++) {
		arr = sorted[n].split('-');
		cdr = handsets[handset].cdr[parseInt(arr[2])];
		if (cdr) {
			create_record(cdr, n, sorted.length-1);
		}
	}

	// Close the HTML output and write to file
	html += '</body></html>';
	file = config.system.root + '/' + prms.company.code + '/' + handset + '.html';
	write_file (file, html);
}



// ---------------------------------------------------------------------------------------------
// Summary of handset usage
// ---------------------------------------------------------------------------------------------
function report_summary () {
	var packages, n, index, data = [], fmt = [], i, vchg, vexc, dchg, dexc, schg, col = {}, file;

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
	data = ['Handset','Voda'];
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
//			data = ['<a href="' + handsets.seq[i] + '.html">' + handsets.seq[i] + '</a>'];
			data.push('<a href="' + handsets.seq[i] + '.html">Bill</a>');
		}
		else {
//			data = [handsets.seq[i]];
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
	file = config.system.root + '/' + prms.company.code + '/summary.html';
	write_file (file, index);
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
// Argument 1 : Name of file
// Argument 2 : Data to be saved
// ---------------------------------------------------------------------------------------------
function write_file (file, data) {
	fs.writeFile(file, data, function(error) {
		if (error) {
			console.error("Error writing to [" + file + "]: " + error.message);
		}
	});
}
