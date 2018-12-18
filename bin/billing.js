// *********************************************************************************************
// *********************************************************************************************
//
// MVNO Billing
// Copyright 2016 Breato Ltd.
//
// Main billing script using billing records from a CDR file
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
	vsprintf = require('/usr/local/lib/node_modules/sprintf-js').vsprintf,
	billing = require('/home/bf/Drive/Software/MVNO/rates.json'),
	config = {}, rates = {}, stats = {}, unrated = [];

// Read the command line parameters
for (i=2; i<process.argv.length; i++) {
	opt = process.argv[i].split('=');
	if (opt[0] === '-cdr') {
		config.cdrfile = opt[1];
	}
	if (opt[0] === '-out') {
		config.output = opt[1];
	}
}

// Both options must be provided
if (config.cdrfile === undefined || config.output === undefined) {
	console.log("Specify both -cdr and -out (table|csv) arguments");
	return;
}

// Build the rates object
build_rates(billing.rates, billing.types);

// Read CDR file
load_cdrs();



// ---------------------------------------------------------------------------------------------
// Add details for an new handset
//
// Argument 1 : ID of the handset
// ---------------------------------------------------------------------------------------------
function add_handset (id) {
	if (!stats[id]) {
		stats[id] = {};
		stats[id].duration = {};
		stats[id].duration.voice = {};
		stats[id].duration.voice.other = 0;
		stats[id].volume = {};
		stats[id].charge = {};
	}
}



// ---------------------------------------------------------------------------------------------
// Build up usage stats for each handset
//
// Argument 1 : Call data record object
//		cdr.caller
//		cdr.called
//		cdr.type
//		cdr.time
//		cdr.duration
//		cdr.volume
//		cdr.details
//		cdr.charge
//		cdr.included
// ---------------------------------------------------------------------------------------------
function aggregate (cdr) {
	var pfx3, pfx4, pfx5;

	// Voice calls
	if (cdr.type === 'voice') {
		// Split duration by type
		// Try most specific match for a call type using prefix
		pfx5 = cdr.called.substring(0,5);
		pfx4 = cdr.called.substring(0,4);
		pfx3 = cdr.called.substring(0,3);
		if (rates.voice[pfx5]) {
			add_handset(cdr.caller);
			stats[cdr.caller].charge.voice = (stats[cdr.caller].charge.voice === undefined) ? cdr.charge : cdr.charge + stats[cdr.caller].charge.voice;
			stats[cdr.caller].volume.voice = (stats[cdr.caller].volume.voice === undefined) ? cdr.volume : cdr.volume + stats[cdr.caller].volume.voice;
			stats[cdr.caller].duration.voice[pfx5] = (stats[cdr.caller].duration.voice[pfx5] === undefined) ? cdr.duration : cdr.duration + stats[cdr.caller].duration.voice[pfx5];
		}
		else if (rates.voice[pfx4]) {
			add_handset(cdr.caller);
			stats[cdr.caller].charge.voice = (stats[cdr.caller].charge.voice === undefined) ? cdr.charge : cdr.charge + stats[cdr.caller].charge.voice;
			stats[cdr.caller].volume.voice = (stats[cdr.caller].volume.voice === undefined) ? cdr.volume : cdr.volume + stats[cdr.caller].volume.voice;
			stats[cdr.caller].duration.voice[pfx4] = (stats[cdr.caller].duration.voice[pfx4] === undefined) ? cdr.duration : cdr.duration + stats[cdr.caller].duration.voice[pfx4];
		}
		else if (rates.voice[pfx3]) {
			add_handset(cdr.caller);
			stats[cdr.caller].charge.voice = (stats[cdr.caller].charge.voice === undefined) ? cdr.charge : cdr.charge + stats[cdr.caller].charge.voice;
			stats[cdr.caller].volume.voice = (stats[cdr.caller].volume.voice === undefined) ? cdr.volume : cdr.volume + stats[cdr.caller].volume.voice;
			stats[cdr.caller].duration.voice[pfx3] = (stats[cdr.caller].duration.voice[pfx3] === undefined) ? cdr.duration : cdr.duration + stats[cdr.caller].duration.voice[pfx3];
		}
		// No match for any defined prefix
		else {
			unrated.push(cdr);
		}
	}
	// Data call
	else if (cdr.type === 'data') {
		add_handset(cdr.caller);
		stats[cdr.caller].charge.data = (stats[cdr.caller].charge.data === undefined) ? cdr.charge : cdr.charge + stats[cdr.caller].charge.data;
		stats[cdr.caller].volume.data = (stats[cdr.caller].volume.data === undefined) ? cdr.volume : cdr.volume + stats[cdr.caller].volume.data;
		stats[cdr.caller].duration.data = (stats[cdr.caller].duration.data === undefined) ? cdr.duration : cdr.duration + stats[cdr.caller].duration.data;
	}
	// All other cases are texts, pictures, etc
	else {
		add_handset(cdr.caller);
		stats[cdr.caller].charge.sms = (stats[cdr.caller].charge.sms === undefined) ? cdr.charge : cdr.charge + stats[cdr.caller].charge.sms;
		stats[cdr.caller].volume.sms = (stats[cdr.caller].volume.sms === undefined) ? 1 : 1 + stats[cdr.caller].volume.sms;
	}
}



// ---------------------------------------------------------------------------------------------
// Build the rates object
// Note: Only handles 2 levels of object nesting
//
// Argument 1 : Object holding rates to be substituted
// Argument 2 : Object holding nodes to be processed
// Argument 3 : Node in the object to which the data is to be added
// ---------------------------------------------------------------------------------------------
function build_rates (bands, types, node) {
	var keys, i;

	keys = Object.keys(types);

	for (i=0; i<keys.length; i++) {
		if (typeof types[keys[i]] === 'object') {
			build_rates(bands, types[keys[i]], keys[i]);
		}
		else {
			if (node === undefined) {
				rates[keys[i]] = bands[types[keys[i]]];
			}
			else {
				if (rates[node] === undefined) {
					rates[node] = {};
				}
				rates[node][keys[i]] = bands[types[keys[i]]];
			}
		}
	}
}



// ---------------------------------------------------------------------------------------------
// Post-processing after all records in the billing file have been rated
// ---------------------------------------------------------------------------------------------
function load_cdrs () {
	var cdr;

	// Process the billing data in the CDR file line by line
	cdr = readline.createInterface({
		input: fs.createReadStream(config.cdrfile)
	});

	// Read billing records from CDR file and process
	cdr.on('line', function (line) {
		aggregate(JSON.parse(line));
	});

	// Close the CDR file
	cdr.on('close', function () {
		post_process ();
	});
}



// ---------------------------------------------------------------------------------------------
// Parse a charge to be included in the report
//
// Argument 1 : Charge in pence
//
// If charge is defined return the value as £.p
// If value is not defined, return 0
// ---------------------------------------------------------------------------------------------
function nvl (value) {
	return (value === undefined) ? 0 : parseFloat(value) / 100;
}



// ---------------------------------------------------------------------------------------------
// Post-processing after all records in the billing file have been rated
// ---------------------------------------------------------------------------------------------
function post_process (mvno) {
	var handset, rate, i, n, amt, mvno = {},
		data = [], fmt, keys, numbers, str;

	// Aggregate data by handset
	handset = Object.keys(stats);
	rate = Object.keys(rates.voice);

	// All charges in pence
	for (i=0; i<handset.length; i++) {
		mvno[handset[i]] = {};
		mvno[handset[i]].total = 0;

		// Voice calls are charged per minute
		mvno[handset[i]].voice = {};
		mvno[handset[i]].voice.total = 0;
		for (n=0; n<rate.length; n++) {
			if (stats[handset[i]].duration.voice[rate[n]]) {
				amt = rates.voice[rate[n]] * (stats[handset[i]].duration.voice[rate[n]]) / 60;
				mvno[handset[i]].voice[rate[n]] = amt;
				mvno[handset[i]].voice.total += amt;
				mvno[handset[i]].total += amt;
			}
		}

		// Data usage is charged per MB
		amt = rates.data * stats[handset[i]].volume.data / 1000000;
		mvno[handset[i]].data = amt;
		mvno[handset[i]].total += amt;

		// SMS usage is charged per text
		amt = rates.sms * stats[handset[i]].volume.sms;
		mvno[handset[i]].sms = amt;
		mvno[handset[i]].total += amt;
	}

	// Generate a tabular report and show on screen
	if (config.output === "table") {
		// Header
		data.push('Caller');
		data.push('Data');
		data.push('SMS');
		fmt = "%-15s %8s %8s";
		keys = Object.keys(rates.voice);
		for (i=0; i<keys.length; i++) {
			data.push(keys[i]);
			fmt += " %8s";
		}
		console.log(vsprintf(fmt, data));

		// Data
		numbers = Object.keys(mvno);
		for (n=0; n<numbers.length; n++) {
			data = [];
			data.push(numbers[n]);
			data.push(nvl(mvno[numbers[n]].data));
			data.push(nvl(mvno[numbers[n]].sms));
			fmt = "%-15s %8.2f %8.2f";
			for (i=0; i<keys.length; i++) {
				data.push(nvl(mvno[numbers[n]].voice[keys[i]]));
				fmt += " %8.2f";
			}
			console.log(vsprintf(fmt, data));
		}
	}
	// Generate a CSV file and show on screen
	else {
		// Header
		str = 'Caller,Data,SMS';
		keys = Object.keys(rates.voice);
		for (i=0; i<keys.length; i++) {
			str += ',' + keys[i];
		}
		console.log(str);

		// Data
		numbers = Object.keys(mvno);
		for (n=0; n<numbers.length; n++) {
			str = numbers[n];
			str += ',' + nvl(mvno[numbers[n]].data);
			str += ',' + nvl(mvno[numbers[n]].sms);
			for (i=0; i<keys.length; i++) {
				str += ',' + nvl(mvno[numbers[n]].voice[keys[i]]);
			}
			console.log(str);
		}
	}

	// Details of unrated calls
	if (unrated.length > 0) {
		console.log('\nUNRATED CALLS');
		console.log(unrated);
	}
}
