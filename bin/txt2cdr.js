// *********************************************************************************************
// *********************************************************************************************
//
// MVNO Billing
// Copyright 2016 Breato Ltd.
//
// Convert billing records in a CSV file into CDRs
//
// *********************************************************************************************
// *********************************************************************************************

var	fs = require('fs'),
	lineByLine = require('/usr/local/lib/node_modules/n-readlines'),
	moment = require('/usr/local/lib/node_modules/moment'),
	readline, line, prms = {}, cdr, state = {};

// Initialise the state object
state.caller = '';
state.calls = [];
state.columns = -1;
state.current_date = '';

// Read the command line parameters
for (i=2; i<process.argv.length; i++) {
	opt = process.argv[i].split('=');
	if (opt[0] === '-cdr') {
		prms.cdrfile = opt[1];
	}
	if (opt[0] === '-txt') {
		prms.txtfile = opt[1];
	}
}

// Both options must be provided
if (prms.cdrfile === undefined || prms.txtfile === undefined) {
	console.log("Specify both -cdr and -txt arguments");
	return;
}

// Delete CDR file then load new file
delete_cdr();



// ---------------------------------------------------------------------------------------------
// Calculate the duration in seconds from '00h 00m 00s' or '00m 00s'
//
// Argument 1 : Duration
//
// Return duration in seconds
// ---------------------------------------------------------------------------------------------
function calc_duration (str) {
	var arr = str.split(' '), dur = 0;

	// Check for seconds, remove from array if found
	if (arr[arr.length-1].search(/[0-9]+s/) === 0) {
		dur += parseInt(arr[arr.length-1].replace(/s/, ''));
		arr.pop();
	}

	// Check for minutes, remove from array if found
	if (arr[arr.length-1].search(/[0-9]+m/) === 0) {
		dur += parseInt(arr[arr.length-1].replace(/m/, '')) * 60;
		arr.pop();
	}

	// Check for hours
	if (arr.length > 0 && arr[arr.length-1].search(/[0-9]+h/) === 0) {
		dur += parseInt(arr[arr.length-1].replace(/h/, '')) * 3600;
	}

	return dur;
}



// ---------------------------------------------------------------------------------------------
// Calculate the volume in KB from '0.000KB|MB|GB'
//
// Argument 1 : Volume
//
// Return volume in KB
// ---------------------------------------------------------------------------------------------
function calc_volume (str) {
	var vol = 0;

	vol += (str.search(/KB/) === -1) ? 0 : parseFloat(str.replace(/KB/, ''));
	vol += (str.search(/MB/) === -1) ? 0 : parseFloat(str.replace(/MB/, '')) * 1000;
	vol += (str.search(/GB/) === -1) ? 0 : parseFloat(str.replace(/GB/, '')) * 1000000;

	return vol;
}



// ---------------------------------------------------------------------------------------------
// Remove leading, trailing and duplicate spaces within a string
//
// Argument 1 : String to be cleaned
//
// Return cleaned-up string
// ---------------------------------------------------------------------------------------------
function clean_str (str) {
	str = str.replace(new RegExp('^ +'),'');		// Remove leading spaces
	str = str.replace(new RegExp(' +$'),'');		// Remove trailing spaces
	str = str.replace(new RegExp(' +','g'),' ');	// Remove duplicate spaces in the string
	return str;
}



// ---------------------------------------------------------------------------------------------
// Convert date string into a date string
//
// Argument 1 : Date string (Day DD Mon)
//

// Return date in DD/MM/YY format
// ---------------------------------------------------------------------------------------------
function convert_date (str) {
	var arr = clean_str(str).split(' ', 3);
	return moment(arr[1]+' '+arr[2]+'2016', 'DD MMM YYYY').format('DD/MM/YY');
}



// ---------------------------------------------------------------------------------------------
// Delete CDR file
// ---------------------------------------------------------------------------------------------
function delete_cdr () {
	fs.exists(prms.cdrfile, function(exists) {
		// Delete existing CDR file
		if(exists) {
			fs.unlink(prms.cdrfile);
		}

		// Create new CDR file
		// File must be read sequentially as date persists between records
		readline = new lineByLine(prms.txtfile);
		while (line = readline.next()) {
			process_line(line.toString('ascii'));
		}
	});
}



// ---------------------------------------------------------------------------------------------
// Extract the charges from the string then remove from the string
//
// Argument 1 : String holding CDR
//
// Return an object holding cleaned string, actual, youpay
// ---------------------------------------------------------------------------------------------
function extract_charge (str) {
	var charges = [], result = {};

	charges = str.match(/[0-9]+\.[0-9]+/g);
	if (charges.length > 0) {
		result.charge = 100 * parseFloat(charges[0]);
		result.included = (parseFloat(charges[1]) === 0) ? 'true' : 'false';
		result.data = str.replace(/[0-9]+\.[0-9]+/g, '');
	}
	else {
		result = {};
	}

	return result;
}



// ---------------------------------------------------------------------------------------------
// Extract a pattern of text from the string then remove from the string
//
// Argument 1 : String holding CDR
// Argument 2 : Pattern to be found and replaced
//
// Return an object holding cleaned string, detail text
// ---------------------------------------------------------------------------------------------
function extract_detail (str, pattern) {
	var result = {}, regex;

	regex = new RegExp(pattern, 'i');
	result.detail = str.match(regex)[0];
	result.data = str.replace(regex, '');

	return result;
}



// ---------------------------------------------------------------------------------------------
// Extract the time (MM24:MI) from the string then remove time from the string
//
// Argument 1 : String holding CDR
//
// Return an object holding cleaned string, time
// ---------------------------------------------------------------------------------------------
function extract_time (str) {
	var result = {};

	if (str.search(/^[0-2][0-9]:[0-5][0-9]/) !== -1) {
		result.time = str.match(/^[0-2][0-9]:[0-5][0-9]/)[0];
		result.data = str.replace(/^[0-2][0-9]:[0-5][0-9]/, '');
	}
	else {
		result = {};
	}

	return result;
}



// ---------------------------------------------------------------------------------------------
// Search for patterns in string and save value in state.columns
//
// Argument 1 : String to be searched
//
// Result
//		-1 = Pattern not found
//		 0 = Only 1 instance of pattern found (at position 0)
//		 n = 2 instances of pattern found (1st at position 0 and 2nd at n)
// ---------------------------------------------------------------------------------------------
function find_cols (str) {
	var pos, arr = [];

	// Search for first occurance of pattern in string
	// '- ' | 'HH:MI' | 'DOW'
	pos = str.search(/\- +|[0-2][0-9]:[0-5][0-9]|Sun|Mon|Tue|Wed|Thu|Fri|Sat/);
	
	// If nothing found, set to -1
	if (pos === -1) { 
		state.columns = -1;
	}
	// Pattern found
	else {
		// Look for 2nd column by chopping first 10 characters and searching again
		str = str.substring(10);
		pos = str.search(/\- +|[0-2][0-9]:[0-5][0-9]|Sun|Mon|Tue|Wed|Thu|Fri|Sat/);
		
		// If nothing found, set to 0
		if (pos === -1) { 
			state.columns = 0;
		}
		// If found, save the position
		else {
			state.columns = pos + 10;
		}
	}
}



// ---------------------------------------------------------------------------------------------
// Process a single billing record
//
// Argument 1 : String of CDR data
//
// Generate a CDR object with these elements
//		cdr.caller
//		cdr.called
//		cdr.type		(voice|data|text|longtext|picture)
//		cdr.time		(DD/MM/YY HH:MI)
//		cdr.duration	(seconds)
//		cdr.volume		(KB)
//		cdr.details
//		cdr.charge		(pence)
//		cdr.included	(true/false)
// ---------------------------------------------------------------------------------------------
function process_cdr (data) {
	var str = [], tmp = {}, cdr = {}, fld = [], called, num, nam,i;

	// Skip if empty or all spaces
	if (data === '' || data.replace(/ /g, '') === '') {
		return;
	}

	// Ignore line if it holds a known word from a summary line
	if (data.search(/total|continued|time|messaging|preferred|£/i) !== -1) {
		return;
	}

	// If line starts with day of week, extract the date and use it for the following CDRs
	if (data.search(/Sun |Mon |Tue |Wed |Thu |Fri |Sat /) !== -1) {
		state.current_date = convert_date(data);
		return;
	}

	// Skip rows with less than 4 data items (should be 5 but internet details can be blank)
	str = clean_str(data);
	if (str.split(' ').length < 4) {
		skipped('process_cdr', 'missing data', state.caller, data);
		return;
	}

	// Check for data picture CDRs
	// 18:53 447971794696 Picture 0.375 0.375
	if (data.search(/picture/i) !== -1) {
		cdr.type = 'picture';
		// Time
		tmp = extract_time(data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.time = state.current_date + ' ' + tmp.time;

		// Amount in pence and is the charge inclusive in the bundle (true) or not (false)
		tmp = extract_charge(tmp.data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.charge = tmp.charge;
		cdr.included = tmp.included;

		// Number called and details
		tmp = extract_detail(tmp.data,'picture');
		cdr.details = clean_str(tmp.detail);
		cdr.called = clean_str(tmp.data);

		// Save the CDR
		write_cdr(state.caller, cdr);
	}

	// Check for data video CDRs
	// 18:53 447971794696 Video 0.375 0.375
	else if (data.search(/video/i) !== -1) {
		cdr.type = 'video';
		// Time
		tmp = extract_time(data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.time = state.current_date + ' ' + tmp.time;

		// Amount in pence and is the charge inclusive in the bundle (true) or not (false)
		tmp = extract_charge(tmp.data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.charge = tmp.charge;
		cdr.included = tmp.included;

		// Number called and details
		tmp = extract_detail(tmp.data,'video');
		cdr.details = clean_str(tmp.detail);
		cdr.called = clean_str(tmp.data);

		// Save the CDR
		write_cdr(state.caller, cdr);
	}

	// Check for data long text CDRs
	// 19:23 lorna.satchwell@gva.c Long Text 0.150 0.150
	else if (data.search(/long text/i) !== -1) {
		cdr.type = 'longtext';
console.log('LONG TEXT: '+data);
		// Time
		tmp = extract_time(data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.time = state.current_date + ' ' + tmp.time;

		// Amount in pence and is the charge inclusive in the bundle (true) or not (false)
		tmp = extract_charge(tmp.data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.charge = tmp.charge;
		cdr.included = tmp.included;

		// Number called and details
		tmp = extract_detail(tmp.data,'long text');
		cdr.details = clean_str(tmp.detail);
		cdr.called = clean_str(tmp.data);

		// Save the CDR
console.log('LONG TEXT: OK');
		write_cdr(state.caller, cdr);
	}

	// Check for data text CDRs
	// - 447525478804 3 texts 0.450 0.000
	else if (data.search(/text/i) !== -1) {
		cdr.type = 'text';
		// Time in HH:MI format
		if (data.search(/^[0-2][0-9]:[0-5][0-9]/) !== -1) {
			tmp = extract_time(data);
			if (Object.keys(tmp).length === 0) {
				skipped('process_cdr', 'error', state.caller, data);
				return; 
			}
			cdr.time = state.current_date + ' ' + tmp.time;
		}
		// Time as '-'
		else {
			tmp = extract_detail(data.replace(/\-/i, ''));
			cdr.time = state.current_date + ' 00:00';
		}

		// Amount in pence and is the charge inclusive in the bundle (true) or not (false)
		tmp = extract_charge(tmp.data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.charge = tmp.charge;
		cdr.included = tmp.included;

		// Number called and details
		tmp = extract_detail(tmp.data,'[0-9]+ text[s]*');
		num = parseInt(tmp.detail.split(' ')[0]);
		cdr.charge = cdr.charge / num;
		cdr.details = '1 text';
		cdr.called = clean_str(tmp.data);

		// Create 1 record per text
		for (i=0; i<num; i++) {
			write_cdr(state.caller, cdr);
		}
	}

	// Check for data mobile internet CDRs
	// - Mobile internet 82.719MB 0.000 0.000
	else if (data.search(/[0-9]+\.[0-9]+[G|M|K]B/i) !== -1) {
		cdr.type = 'data';

		// Time
		cdr.time = state.current_date + ' 00:00';

		// Amount of data used - no number called
		tmp = extract_detail(data.replace(/\-/i, ''),'[0-9]+\.[0-9]+[G|M|K]B');
		cdr.details = clean_str(tmp.detail);
		cdr.called = '';

		// Volume in KB
		cdr.volume = calc_volume(tmp.detail);

		// Amount in pence and is the charge inclusive in the bundle (true) or not (false)
		tmp = extract_charge(tmp.data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.charge = tmp.charge;
		cdr.included = tmp.included;

		// Save the CDR
		write_cdr(state.caller, cdr);
	}

	// Check for voice CDRs
	// 17:41 01394420241 Felixstowe 0m 38s 0.000 0.000
	else if (data.search(/[0-9]+m [0-9]+s/i) !== -1) {
		cdr.type = 'voice';
		// Time
		tmp = extract_time(data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.time = state.current_date + ' ' + tmp.time;

		// Amount in pence and is the charge inclusive in the bundle (true) or not (false)
		tmp = extract_charge(tmp.data);
		if (Object.keys(tmp).length === 0) {
			skipped('process_cdr', 'error', state.caller, data);
			return; 
		}
		cdr.charge = tmp.charge;
		cdr.included = tmp.included;

		// If 00h 00m 00s
		if (tmp.data.search(/[0-9]+h [0-9]+m [0-9]+s/i) !== -1) {
			tmp = extract_detail(tmp.data,'[0-9]+h [0-9]+m [0-9]+s');
			called = clean_str(tmp.data);
		}
		// Otherwise 00m 00s
		else {
			tmp = extract_detail(tmp.data,'[0-9]+m [0-9]+s');
			called = clean_str(tmp.data);
		}

		// Duration taken from 'more details' converted to seconds
		cdr.duration = calc_duration(tmp.detail);

		// Number called and details
		// If 'Voicemail', switch name and number
		fld = called.split(' ');
		num = fld.shift();
		nam = fld.join(' ');
		cdr.called = (num === 'Voicemail') ? nam : num;
		cdr.details = (num === 'Voicemail') ? num : nam;

		// Save the CDR
		write_cdr(state.caller, cdr);
	}

	// Anything else is skipped
	else {
		skipped('process_cdr', 'nomatch', state.caller, data);
	}
}



// ---------------------------------------------------------------------------------------------
// Process a line of text extracted from the PDF bill
//
// Argument 1 : Line from text file
// ---------------------------------------------------------------------------------------------
function process_line (line) {
	var arr = [], first, last;

	// If line starts with 'Itemisation', read phone number (elements 2-4)
	if (line.search(/^itemisation/i) === 0) {
		arr = line.split(' ');
		state.caller = arr[2] + arr[3] + arr[4];
	}
	// If line starts with 'NEWPAGE', process all saved CDRs
	else if (line.search(/^NEWPAGE/) === 0) {
		while (state.calls.length > 0) {
			process_cdr(state.calls.shift());
		}
	}
	// If line holds 'time', work out columns widths
	else if (line.search(/time/i) !== -1) {
		first = line.indexOf('time');
		last = line.lastIndexOf('time');
		state.columns = (last > first) ? last : first;
	}
	// Process all other records
	else {
		// Search for '- ', 'HH:MI', 'DOW' patterns in string and save value in state.columns
//		find_cols(line);

		// Save everything after the end of left column for later processing
		if (state.columns > 0) {
			state.calls.push(line.substring(state.columns));
			line = line.substring(0, state.columns);
		}

		// Pass data in left column to PROCESS_CDR function
		process_cdr(line);
	}
}



// ---------------------------------------------------------------------------------------------
// Show details of skipped records
//
// Argument 1 : Calling function
// Argument 2 : Reason for skipping
// Argument 3 : Handset the CDR is associated with
// Argument 4 : Raw CDR
// ---------------------------------------------------------------------------------------------
function skipped (fn, reason, handset, line) {
//	var head, type, hand;
	var data;

	// Only show if there is at least 1 numeric character and 1 alpha character
	if (line && line.search(/[0-9]/) !== -1 && line.search(/[A-Z]/i) !== -1) {
		data = "SKIPPED: " + fn + ' - ' + reason + ' (' + handset + ')\n';
		data += "         [" + line + ']';
		console.log(data);
	}
}



// ---------------------------------------------------------------------------------------------
// Append record to CDR file
//
// Argument 1 : Caller's handset number
// Argument 2 : Call data record object
// ---------------------------------------------------------------------------------------------
function write_cdr (caller, cdr) {
	cdr.caller = caller;

	// If a called number starts with '0' replace with '44'
	if (cdr.called) {
		cdr.called = cdr.called.replace(/^0044/, '44');
		cdr.called = cdr.called.replace(/^0/, '44');
	}

	// Write record to CDR file
	fs.appendFile(prms.cdrfile, JSON.stringify(cdr)+'\n', function(error) {
		if (error) {
			console.error("Error appending to CDR file:  " + error.message);
		}
	});
}
