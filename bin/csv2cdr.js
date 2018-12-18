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
	readline = require('readline'),
	config = {}, i, opt = [], recno = 0, csv;

// Read the command line parameters
for (i=2; i<process.argv.length; i++) {
	opt = process.argv[i].split('=');
	if (opt[0] === '-csv') {
		config.csvfile = opt[1];
	}
	if (opt[0] === '-cdr') {
		config.cdrfile = opt[1];
	}
}

// Both options must be provided
if (config.csvfile === undefined || config.cdrfile === undefined) {
	console.log("Specify both -csv and -cdr arguments");
	return;
}

// Delete CDR file
delete_cdr();

// Process the billing data in the CSV file line by line
csv = readline.createInterface({
	input: fs.createReadStream(config.csvfile)
});



// ---------------------------------------------------------------------------------------------
// Read billing records from CSV file, process and write to CDR file
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
csv.on('line', function (line) {
	var arr = [], cdr = {}, num;

	// Split record into fields
	arr = line.split(',');

	// Stop if header row
	recno++;
	if (recno === 1 ) {
		return;
	}

	// Process call record details
	cdr.caller = arr[0];
	cdr.time = arr[2] + ' ' + arr[3];
	cdr.called = arr[4];

	// CDR type
	if (arr[4].search(/^Mobile/i) === 0) { cdr.type = 'data'; }
	else if (arr[5] === '00:00:00') { cdr.type = 'text'; }
	else { cdr.type = 'voice'; }

	// Volume format 1234 KB, convert to bytes
	num = arr[6].split(' ');
	switch (num[1]) {
		case 'KB':
			cdr.volume = parseInt(num[0].replace(',', '')) * 1000;
			break;
		case 'MB':
			cdr.volume = parseInt(num[0].replace(',', '')) * 1000000;
			break;
		case 'GB':
			cdr.volume = parseInt(num[0].replace(',', '')) * 1000000000;
			break;
		default:
			cdr.volume = parseInt(num[0].replace(',', ''));
	}

	// Duration format HH:MM:SS, convert to seconds
	num = arr[5].split(':');
	cdr.duration = (3600*parseInt(num[0])) + (60*parseInt(num[1])) + parseInt(num[2]);

	// Charge has a leading currency symbol, convert to pence		// IS CURRENCY SYMBOL ALWAYS £ ?????????????
	cdr.charge = 100 * parseFloat(arr[7].substring(1));
	
	// Is the charge inclusive in the bundle (true) or not (false)
	cdr.included = (arr[8] === 'I') ? 'true' : 'false';
	
	// Extra details about the destination
	cdr.details = arr[9];

	// Write record to CDR file
	write_cdr(cdr);
});



// ---------------------------------------------------------------------------------------------
// Close the CSV file
// ---------------------------------------------------------------------------------------------
csv.on('close', function () {
});



// ---------------------------------------------------------------------------------------------
// Delete CDR file
// ---------------------------------------------------------------------------------------------
function delete_cdr () {
	fs.exists(config.cdrfile, function(exists) {
		if(exists) {
			fs.unlink(config.cdrfile);
		}
	});
}



// ---------------------------------------------------------------------------------------------
// Append record to CDR file
//
// Argument 1 : Call data record object
// ---------------------------------------------------------------------------------------------
function write_cdr (obj) {
	fs.appendFile(config.cdrfile, JSON.stringify(obj)+'\n', function(error) {
		if (error) {
			console.error("Error appending to CDR file:  " + error.message);
		}
	});
}
