// forever start -c nodemon main.js
var express = require('express');
var http = require('http');
var path = require('path');
var mongoose = require('mongoose');
var fs = require('fs');
var processData = require('./processdata.js');
var app = express();
var CronJob = require('cron').CronJob;
var cronFive = '0 */5 * * * *';

app.use(express.static(process.cwd() + '../../public'));
app.set('port', process.env.PORT || 3000);

// Connect mongoose to MongoDB
mongoose.connect('mongodb://localhost/smartmeter');
mongoose.connection.on('error', function (err) {
    console.log('Mongo connection error' + err);
});

// Load models
fs.readdirSync(__dirname + '/models').forEach(function (filename) {
    if (~filename.indexOf('.js')) require(__dirname + '/models/' + filename)
});

try {
    console.log('Starting Cron job');
    new CronJob(cronFive, function () {

        var date = new Date();
        if (date.getMinutes() === 00) {
            processData.openSerialPort();
        }
    }, function () {
        console.log('Something bad happened');
    },
        true, // run directly
        'Europe/Amsterdam');
} catch (ex) {
    console.log("cron pattern not valid");
}

app.get('/measurements/:date', function (req, res, next) {

    var url = 'localhost:3000/calculatedmeasurement/';
    var date = new Date(req.params.date);

    var options = {
        host: url,
        port: 3000,
        path: date,
        method: 'GET'
    };

    if (date.length === 4) {
        
    } else if (date.length === 7) {

    } else if (date.length === 10) {
        mongoose.model('measurement').find({ date: date }, function (err, measurement) {
            if (err) { console.log('err: ' + err); }
            res.send(measurement);
        });
    }

    function getData(options) {
        var returnedData = [];
        http.request(options, function (res) {
            // console.log('STATUS: ' + res.statusCode);
            // console.log('HEADERS: ' + JSON.stringify(res.headers));
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                returnedData.append(chunk);
                // console.log('BODY: ' + chunk);
            });
        }).end();
        return returnedData;
    }
});

// at some point implement weeks
// in all cases implement real time date.
app.get('/calculatedmeasurement/:date', function (req, res, next) {
    var Measurement = mongoose.model('measurement');
    var dateMostEarliest;
    var dateMostRecent;

    if (req.params.date.length === 4) {
        var addYear = parseInt(req.params.date) + 1;
        dateMostEarliest = req.params.date + '-01-01';
        dateMostRecent = addYear + '-01-01';
    } else if (req.params.date.length === 7) {
        var year = parseInt(req.params.date.substring(0, 4));
        var month = parseInt(req.params.date.substring(5, 7));
        if (month == 12) {
            year = year + 1;
            month = 1;
        } else {
            month = month + 1;
        }
        dateMostEarliest = req.params.date + '-01';
        dateMostRecent = year.toString() + '-0' + month.toString();

        // Day, get most recent and latest for given day
    } else if (req.params.date.length === 10) {

        var year = req.params.date.substring(0, 4);
        var month = req.params.date.substring(5, 7);

        dateMostEarliest = req.params.date;
        dateMostRecent = req.params.date;

        var newDate = new Date(dateMostRecent);
        newDate.setDate(newDate.getDate() + 1);

        dateMostRecent = newDate;
    } else {
        // res.send('Wrong input, should be:     \n' +
        //     '- /calculatedmeasurement/YYYY    \n' +
        //     '- /calculatedmeasurement/YYYY-MM \n ' +
        //     '- /calculatedmeasurement/YYYY-MM-DD');
    }

    Measurement.findOne({ dateTime: { $gte: new Date(dateMostEarliest) } }, function (err, firstMeasurement) {
        if (err) {
            console.log('err: ' + err);
        } else {
            Measurement.findOne({ dateTime: { $gte: new Date(dateMostRecent) } }, function (err, secondMeasurement) {
                if (err) {
                    console.log('err: ' + err);
                }
                if (secondMeasurement == null) {
                    Measurement.findOne({}, {}, { sort: { 'dateTime': -1 } }, function (err, secondMeasurement) {
                        if (err) {
                            console.log('err: ' + err);
                        } else {
                            var consumption = calculatedMessage(firstMeasurement, secondMeasurement);
                            res.json({ consumption: consumption });
                        }
                    });
                } else {
                    var gasConsumption = calculatedMessage(firstMeasurement, secondMeasurement);

                    var consumption = calculatedMessage(firstMeasurement, secondMeasurement);
                    res.json({ consumption: consumption });
                }
            });
        }
    });
});

function calculatedMessage(firstMeasurement, secondMeasurement) {

    var json = {};

    if (firstMeasurement === null || secondMeasurement === null) {
        json["error"] = 'No data found';
    } else {
        var meter181kWh = parseFloat(secondMeasurement.meter181kWh) - parseFloat(firstMeasurement.meter181kWh);
        var meter281kWh = parseFloat(secondMeasurement.meter281kWh) - parseFloat(firstMeasurement.meter281kWh);
        var meter182kWh = parseFloat(secondMeasurement.meter182kWh) - parseFloat(firstMeasurement.meter182kWh);
        var meter282kWh = parseFloat(secondMeasurement.meter282kWh) - parseFloat(firstMeasurement.meter282kWh);
        var gasConsumption = parseFloat(secondMeasurement.gasMeasurementm3 -
            parseFloat(firstMeasurement.gasMeasurementm3));

        json["dateTimeFirstMeasurement"] = firstMeasurement.dateTime;
        json["dateTimeSecondMeasurement"] = secondMeasurement.dateTime;
        json["meter181kWh"] = Number(meter181kWh.toPrecision(5));
        json["meter281kWh"] = Number(meter281kWh.toPrecision(5));
        json["meter182kWh"] = Number(meter182kWh.toPrecision(5));
        json["meter282kWh"] = Number(meter282kWh.toPrecision(5));
        json["gasConsumption"] = Number(gasConsumption.toPrecision(5));
    }
    return json;
}

/*
 *   Finds the first recorded measurement and the last recorded measurement
 *   Used for figuring out what data is available for what dates
 */
app.get('/availabledata', function (req, res, next) {

    var Measurement = mongoose.model('measurement');
    Measurement.findOne({}, {}, { sort: { 'dateTime': 1 } }, function (err, firstMeasurement) {
        if (err) { console.log('err: ' + err); }

        Measurement.findOne({}, {}, { sort: { 'dateTime': -1 } }, function (err, secondMeasurement) {
            if (err) { console.log('err: ' + err); }
            res.json({ firstRecord: firstMeasurement, lastRecord: secondMeasurement });
        });
    });
});

app.listen(3000, function () {
    console.log('App listening on port 3000 at:' + new Date());
});