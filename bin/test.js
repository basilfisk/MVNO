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
	rates = require('/home/bf/Drive/Software/MVNO/etc/rates.json'),				// DON'T REQUIRE....READ !!!!!!!!!!!!!!!!
	company = require('/home/bf/Drive/Software/MVNO/etc/sitec.json'),			// DON'T REQUIRE....READ !!!!!!!!!!!!!!!!
	vodafone = require('/home/bf/Drive/Software/MVNO/etc/vodafone.json'),		// DON'T REQUIRE....READ !!!!!!!!!!!!!!!!
	config = {}, rate_plans = {}, usage = {}, unrated = [];

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
build_rates(rates.charges, rates.plans);

// Read CDR file
load_cdrs();



// ---------------------------------------------------------------------------------------------
// Add details for an new handset
//
// Argument 1 : ID of the handset
// ---------------------------------------------------------------------------------------------
function add_handset (id) {
	if (!usage[id]) {
		usage[id] = {};
		usage[id].data = {};
		usage[id].data.billed = 0;
		usage[id].data.charge = 0;
		usage[id].data.duration = 0;
		usage[id].data.volume = 0;
		usage[id].sms = {};
		usage[id].sms.billed = 0;
		usage[id].sms.charge = 0;
		usage[id].sms.volume = 0;
		usage[id].voice = {};
		usage[id].voice.billed = 0;
		usage[id].voice.charge = 0;
		usage[id].voice.duration = {};
		usage[id].voice.volume = 0;
	}
}



// ---------------------------------------------------------------------------------------------
// Build up usage data for each handset
//
// Argument 1 : Call data record object
//		caller, called, type, time, duration, volume, details, charge, included
//
// Aggregated usage data stored in 'usage' object
//		data.billed
//		data.charge
//		data.duration
//		data.volume
//		sms.billed
//		sms.charge
//		sms.volume
//		voice.billed
//		voice.charge
//		voice.duration
//		voice.volume
// ---------------------------------------------------------------------------------------------
function aggregate (cdr) {
	var pfx;

	// Check if details for a new handset have been read
	add_handset(cdr.caller);

	// Voice usage
	if (cdr.type === 'voice') {
		// Aggregate charge and volume
		usage[cdr.caller].voice.billed += (cdr.included === 'false') ? cdr.charge : 0;
		usage[cdr.caller].voice.charge += cdr.charge;
		usage[cdr.caller].voice.volume += cdr.volume;

		// Aggregate duration based on leading numbers of number called
		// Try most specific match for a call rate using prefix
		if (rate_plans.voice[cdr.called.substring(0,5)] !== undefined) {
			pfx = cdr.called.substring(0,5);
			if (usage[cdr.caller].voice.duration[pfx] === undefined) { usage[cdr.caller].voice.duration[pfx] = 0 };
			usage[cdr.caller].voice.duration[pfx] += cdr.duration
		}
		else if (rate_plans.voice[cdr.called.substring(0,4)] !== undefined) {
			pfx = cdr.called.substring(0,4);
			if (usage[cdr.caller].voice.duration[pfx] === undefined) { usage[cdr.caller].voice.duration[pfx] = 0 };
			usage[cdr.caller].voice.duration[pfx] += cdr.duration
		}
		else if (rate_plans.voice[cdr.called.substring(0,3)] !== undefined) {
			pfx = cdr.called.substring(0,3);
			if (usage[cdr.caller].voice.duration[pfx] === undefined) { usage[cdr.caller].voice.duration[pfx] = 0 };
			usage[cdr.caller].voice.duration[pfx] += cdr.duration
		}
		// Save im temporary obkect if there is no match for any rate band
		else {
			unrated.push(cdr);
		}
	}
	// Data usage: aggregate charge, volume and duration
	else if (cdr.type === 'data') {
		usage[cdr.caller].data.billed += (cdr.included === 'false') ? cdr.charge : 0;
		usage[cdr.caller].data.charge += cdr.charge;
		usage[cdr.caller].data.volume += cdr.volume;
		usage[cdr.caller].data.duration += cdr.duration;
	}
	// All other cases are texts, pictures, etc: aggregate charge and quantity
	else {
		usage[cdr.caller].sms.billed += (cdr.included === 'false') ? cdr.charge : 0;
		usage[cdr.caller].sms.charge += cdr.charge;
		usage[cdr.caller].sms.volume += 1;
	}

	// Running totals
}



// ---------------------------------------------------------------------------------------------
// Build the rate_plans object
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
				rate_plans[keys[i]] = bands[types[keys[i]]];
			}
			else {
				if (rate_plans[node] === undefined) {
					rate_plans[node] = {};
				}
				rate_plans[node][keys[i]] = bands[types[keys[i]]];
			}
		}
	}
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
	cdr.on('close', function () {unrated.length
		report();
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
// Produce report after all records in the billing file have been rated
//
// Aggregated usage data stored in 'usage' object
//		data.billed
//		data.charge
//		data.duration
//		data.volume
//		sms.billed
//		sms.charge
//		sms.volume
//		voice.billed
//		voice.charge
//		voice.duration
//		voice.volume
// ---------------------------------------------------------------------------------------------
function report () {
	var handset, rate, i, caller, n, amt, mvno = {}, plans, arr,
		data = [], fmt, keys, numbers, str, dat, sms, voi, tot = [], pct;

	// Aggregate data by handset
	handset = Object.keys(company.handsets).sort();
	rate = Object.keys(rate_plans.voice);

	// All charges in pence
	for (i=0; i<handset.length; i++) {
		caller = handset[i];
		mvno[caller] = {};
		mvno[caller].total = 0;
		mvno[caller].data = {};
		mvno[caller].sms = {};
		mvno[caller].voice = {};
		mvno[caller].voice.secs = 0;
		mvno[caller].voice.total = 0;

		// Handset rental
		plans = company.handsets[caller];
		mvno[caller].rental = 0;
		for (n=0; n<plans.length; n++) {
			arr = plans[n].split('-');
			mvno[caller].rental += vodafone.packages[arr[0]].rates[arr[1]];
		}

		// Generate empty row if there is no data for the handset
		if (usage[caller] === undefined) {
			add_handset(caller);
			mvno[caller].data.total = 0;
			mvno[caller].data.kb = 0;
			mvno[caller].sms.total = 0;
			mvno[caller].sms.qty = 0;
			mvno[caller].voice.total = 0;
			mvno[caller].voice.secs =0;
			for (n=0; n<rate.length; n++) {
				mvno[caller].voice[rate[n]] = 0;
			}
		}
		// There is data for the handset
		else {
			// Data usage is charged per MB, call data held in KB
			amt = rate_plans.data * usage[caller].data.volume / 1000;
			mvno[caller].data.total = amt;
			mvno[caller].data.kb = usage[caller].data.volume;
			mvno[caller].total += amt;

			// SMS usage is charged per text
			amt = rate_plans.sms * usage[caller].sms.volume;
			mvno[caller].sms.total = amt;
			mvno[caller].sms.qty = usage[caller].sms.volume;
			mvno[caller].total += amt;

			// Voice calls are charged per minute
			for (n=0; n<rate.length; n++) {
				if (usage[caller].voice.duration[rate[n]]) {
					amt = rate_plans.voice[rate[n]] * usage[caller].voice.duration[rate[n]] / 60;
					mvno[caller].voice[rate[n]] = amt;
					mvno[caller].voice.total += amt;
					mvno[caller].voice.secs += usage[caller].voice.duration[rate[n]];
					mvno[caller].total += amt;
				}
			}
		}
	}

	// Generate a tabular report and show on screen
	if (config.output === "table") {
		// Header
		data.push('Caller');
		fmt = "%-15s";
		keys = Object.keys(rate_plans.voice);
		for (i=0; i<keys.length; i++) {
			data.push(keys[i]);
			fmt += " %8s";
		}
		fmt += " %8s %8s %8s %8s";
		data.push('Voice');
		data.push('Data');
		data.push('SMS');
		data.push('Total');
		fmt += " %8s %8s %8s %8s";
		data.push('Voice');
		data.push('Data');
		data.push('SMS');
		data.push('Total');
		fmt += " %8s %8s %8s %8s %8s";
		data.push('Voice');
		data.push('Data');
		data.push('SMS');
		data.push('Rental');
		data.push('Total');
		fmt += " %8s %8s";
		data.push('Diff');
		data.push('Pct');
		fmt += " %12s %10s %8s";
		data.push('Voice');
		data.push('Data (kB)');
		data.push('SMS');
		console.log(vsprintf(fmt, data));

		// Usage data
		numbers = Object.keys(mvno);
		for (n=0; n<numbers.length; n++) {
			data = [];
			caller = numbers[n];

			// Caller
			fmt = "%-15s";
			data.push(caller);

			// MVNO Voice package
			for (i=0; i<keys.length; i++) {
				fmt += " %8.2f";
				data.push(nvl(mvno[caller].voice[keys[i]]));
			}

			// MVNO Voice total
			fmt += " %8.2f";
			voi = nvl(mvno[caller].voice.total);
			data.push(voi);

			// MVNO Data total
			fmt += " %8.2f";
			dat = nvl(mvno[caller].data.total);
			data.push(dat);

			// MVNO SMS total
			fmt += " %8.2f";
			sms = nvl(mvno[caller].sms.total);
			data.push(sms);

			// MVNO Grand total
			fmt += " %8.2f";
			tot[0] = voi + dat + sms;
			data.push(tot[0]);

			// Vodafone Voice total (all calls)
			fmt += " %8.2f";
			voi = nvl(usage[caller].voice.charge);
			data.push(voi);

			// Vodafone Data total (all calls)
			fmt += " %8.2f";
			dat = nvl(usage[caller].data.charge);
			data.push(dat);

			// Vodafone SMS total (all calls)
			fmt += " %8.2f";
			sms = nvl(usage[caller].sms.charge);
			data.push(sms);

			// Vodafone Grand total (all calls)
			fmt += " %8.2f";
			tot[1] = voi + dat + sms;
			data.push(tot[1]);

			// Vodafone Voice total (billed calls)
			fmt += " %8.2f";
			voi = nvl(usage[caller].voice.billed);
			data.push(voi);

			// Vodafone Data total (billed calls)
			fmt += " %8.2f";
			dat = nvl(usage[caller].data.billed);
			data.push(dat);

			// Vodafone SMS total (billed calls)
			fmt += " %8.2f";
			sms = nvl(usage[caller].sms.billed);
			data.push(sms);

			// Vodafone handset rental
			fmt += " %8.2f";
			data.push(mvno[caller].rental);

			// Vodafone Grand total (billed calls)
			fmt += " %8.2f";
			tot[2] = voi + dat + sms + mvno[caller].rental;
			data.push(tot[2]);

			// MVNO Vodafone difference
			fmt += " %8.2f";
			data.push(tot[2]-tot[0]);

			// MVNO Vodafone difference percentage
			fmt += " %8.2f";
			pct = 100*(tot[2]-tot[0])/tot[0];
			data.push((tot[0] && pct < 1000) ? pct : 0);

			// Vodafone data, sms and voice usage totals
			fmt += " %12s %10d %8d";
			data.push(format_duration(mvno[caller].voice.secs));
			data.push(mvno[caller].data.kb);
			data.push(mvno[caller].sms.qty);

			// Print row for handset
			console.log(vsprintf(fmt, data));
		}
	}
	// Generate a CSV file and show on screen
	else {
		// Header
		str = 'Caller,Data,SMS';
		keys = Object.keys(rate_plans.voice);
		for (i=0; i<keys.length; i++) {
			str += ',' + keys[i];
		}
		console.log(str);

		// Data
		numbers = Object.keys(mvno);
		for (n=0; n<numbers.length; n++) {
			str = caller;
			str += ',' + nvl(mvno[caller].data);
			str += ',' + nvl(mvno[caller].sms);
			for (i=0; i<keys.length; i++) {
				str += ',' + nvl(mvno[caller].voice[keys[i]]);
			}
			console.log(str);
		}
	}

	// Details of unrated calls
	if (unrated.length > 0) {
		console.log('\n' + unrated.length + ' UNRATED CALLS');
//		console.log(unrated);
	}
}
