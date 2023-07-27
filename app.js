const express = require("express");
const dotenv = require("dotenv");
const pg = require("pg");
const session = require("express-session")
const https = require('https');
const { flash } = require('express-flash-message');
const bodyparser = require("body-parser")
const urlencodedparser = bodyparser.urlencoded({extended:false})

/* Reading global variables from config file */
dotenv.config();
const PORT = process.env.PORT;
const conString = process.env.DB_CON_STRING;
const api_key = process.env.API_KEY;
const Kelvin = 273.15;


if (conString === undefined) {
    console.log("ERROR: environment variable DB_CON_STRING not set.");
    process.exit(1);
}
const dbConfig = {
    connectionString: conString
}
var dbClient = new pg.Client(dbConfig);
dbClient.connect();

/*
 *
 * Express setup
 *
*/
app = express();

//turn on serving static files (required for delivering css to client)
app.use(express.static("public"));
app.use('/images', express.static('images'));
app.use(session({
    secret: "Topsecret",
    cookie : {maxAge: 3600000},
    resave: false,
    saveUninitialized: false
}))
app.use(flash({ sessionKeyName: 'flashMessage' }));

//configure template engine
app.set("views", "views");
app.set("view engine", "pug");


app.get('/', async (req, res) => {
    const message = await req.consumeFlash('error');
    if(message.length !== 0){
        res.render("index.pug", {session : req.session.user, error: message})
    }
    else{
        res.render("index.pug", {session : req.session.user})
    }
});
app.get("/dashboard", async (req, res) => {
    if(!checklogedin(req,res)){
        return;
    }

    let data;
    let length;
    let array = []
    //get all stations
    let query1 = await dbClient.query("SELECT * FROM wetterstationen");
    //id zum berechnen
    let real_id_row = query1.rows;
    let j = 0;
    length = query1.rows.length;

    for(j; j < length; j++) {
        //loop through every station
        let query2 = await dbClient.query("SELECT wetterstation, laengengrad, breitengrad, wetter, temperatur, wind, windrichtung, luftdruck FROM wetterstationen JOIN readings ON readings.stationen_id = wetterstationen.id WHERE wetterstationen.id=$1 ORDER BY zeitpunkt DESC", [real_id_row[j].id]);
        data = query2.rows[0]
        if (data === undefined) {
            let query3 = await dbClient.query("SELECT wetterstation ,laengengrad, breitengrad FROM wetterstationen WHERE wetterstationen.id =$1", [real_id_row[j].id])
            let name = query3.rows[0].wetterstation
            array.push({
                wetterstation: name,
                laengengrad: query3.rows[0].laengengrad,
                breitengrad: query3.rows[0].breitengrad,
                wetter: '/',
                temperatur: '/',
                wind: '/',
                windrichtung: '/',
                luftdruck: '/'
            })
        } else {

            let lastReading = query2.rows[0];
            let readingBefore = query2.rows[1];
            let maxmin = await dbClient.query("SELECT MAX(temperatur) AS maxtemp, MIN(temperatur) AS mintemp, MAX(wind) AS maxwind, MIN(wind) AS minwind, MAX(luftdruck) AS maxluftdruck, MIN(luftdruck) AS minluftdruck FROM readings WHERE readings.stationen_id=$1", [real_id_row[j].id]);
            let weatherdata = convertWeatherData(data.wetter);
            if (lastReading !== undefined && readingBefore !== undefined) {
                lastReading.temperatur = parseFloat(lastReading.temperatur)
                readingBefore.temperatur = parseFloat(readingBefore.temperatur)
                if (lastReading.temperatur > readingBefore.temperatur)
                    data.temperaturTrend = "bi bi-arrow-up-right"
                else
                    data.temperaturTrend = "bi bi-arrow-down-right"
                lastReading.wind = parseFloat(lastReading.wind)
                readingBefore.wind = parseFloat(readingBefore.wind)
                if (lastReading.wind > readingBefore.wind)
                    data.windTrend = "bi bi-arrow-up-right"
                else
                    data.windTrend = "bi bi-arrow-down-right"
                lastReading.luftdruck = parseInt(lastReading.luftdruck, 10)
                readingBefore.luftdruck = parseInt(readingBefore.luftdruck, 10)
                if (lastReading.luftdruck > readingBefore.luftdruck)
                    data.luftdruckTrend = "bi bi-arrow-up-right"
                else
                    data.luftdruckTrend = "bi bi-arrow-down-right"
            }

            data.windrichtung_wortlaut = convertWindrichtung(data.windrichtung);
            data.wetter_icon = weatherdata[0];
            data.wetterbeschreibung = weatherdata[1];
            data.maxtemperatur = maxmin.rows[0].maxtemp;
            data.mintemperatur = maxmin.rows[0].mintemp;
            data.maxwind = maxmin.rows[0].maxwind;
            data.minwind = maxmin.rows[0].minwind;
            data.maxdruck = maxmin.rows[0].maxluftdruck;
            data.mindruck = maxmin.rows[0].minluftdruck;
            array.push(data);
        }
        if (array.length === length) {
            res.render("dashboard.pug", {data: array, length: length, session: req.session.user})
            return;
        }
    }
    res.render("dashboard.pug", {data: array, length : 0})
})

app.get("/stations/:id/delete", (req, res)=>{
    if(!checklogedin(req,res)){
        return;
    }
    let id = req.params.id;
    dbClient.query("SELECT * FROM wetterstationen", function (dbError, dbResult) {
        let id_ = dbResult.rows[id].id;
        dbClient.query("DELETE FROM readings WHERE stationen_id = $1", [id_]);
        dbClient.query("DELETE FROM wetterstationen WHERE id= $1", [id_]);
        res.redirect("/dashboard");
    })
})
app.get("/stations/:id", async (req, res) => {
    if(!checklogedin(req,res)){
        return;
    }
    let id = req.params.id ;
    let row_data;
    let query1 = await dbClient.query("SELECT * FROM wetterstationen")
    let real_id = query1.rows[id].id;
    let query2 = await dbClient.query("SELECT wetterstationen.wetterstation, wetterstationen.laengengrad, wetterstationen.breitengrad,zeitpunkt, wetter, temperatur, wind, windrichtung, luftdruck FROM readings JOIN wetterstationen ON wetterstationen.id = readings.stationen_id WHERE wetterstationen.id=$1 ORDER BY zeitpunkt DESC", [real_id])
    row_data = query2.rows;
    let dashboard_data_array = [...row_data];
    let dashboard_data = dashboard_data_array[0];
    let chartData = [];
    let query4 = await dbClient.query("SELECT wetterstation, laengengrad, breitengrad FROM wetterstationen WHERE id = $1", [real_id])
    if(row_data.length === 0) {
        let name = query4.rows[0].wetterstation;
        dashboard_data = {
            wetterstation: name,
            laengengrad: query4.rows[0].laengengrad,
            breitengrad: query4.rows[0].breitengrad,
            wetter: '/',
            temperatur: '/',
            wind: '/',
            windrichtung: '/',
            luftdruck: '/'
        }
    }
    else{

        let lastReading = query2.rows[0];
        let readingBefore = query2.rows[1];
        let maxmin = await dbClient.query("SELECT MAX(temperatur) AS maxtemp, MIN(temperatur) AS mintemp, MAX(wind) AS maxwind, MIN(wind) AS minwind, MAX(luftdruck) AS maxluftdruck, MIN(luftdruck) AS minluftdruck FROM readings WHERE stationen_id=$1", [real_id]);
        let weatherdata = convertWeatherData(dashboard_data.wetter);
        if(lastReading !== undefined && readingBefore !== undefined){
            lastReading.temperatur = parseFloat(lastReading.temperatur)
            readingBefore.temperatur = parseFloat(readingBefore.temperatur)
            if(lastReading.temperatur > readingBefore.temperatur)
                dashboard_data.temperaturTrend = "bi bi-arrow-up-right"
            else
                dashboard_data.temperaturTrend = "bi bi-arrow-down-right"
            lastReading.wind = parseFloat(lastReading.wind)
            readingBefore.wind = parseFloat(readingBefore.wind)
            if(lastReading.wind > readingBefore.wind)
                dashboard_data.windTrend = "bi bi-arrow-up-right"
            else
                dashboard_data.windTrend = "bi bi-arrow-down-right"
            lastReading.luftdruck = parseInt(lastReading.luftdruck, 10)
            readingBefore.luftdruck = parseInt(readingBefore.luftdruck, 10)
            if(lastReading.luftdruck > readingBefore.luftdruck)
                dashboard_data.luftdruckTrend = "bi bi-arrow-up-right"
            else
                dashboard_data.luftdruckTrend = "bi bi-arrow-down-right"
        }

        dashboard_data.windrichtung_wortlaut = convertWindrichtung(dashboard_data.windrichtung);
        dashboard_data.wetter_icon = weatherdata[0];
        dashboard_data.wetterbeschreibung = weatherdata[1];
        dashboard_data.maxtemperatur = maxmin.rows[0].maxtemp;
        dashboard_data.mintemperatur = maxmin.rows[0].mintemp;
        dashboard_data.maxwind =  maxmin.rows[0].maxwind;
        dashboard_data.minwind = maxmin.rows[0].minwind;
        dashboard_data.maxluftdruck = maxmin.rows[0].maxluftdruck;
        dashboard_data.minluftdruck = maxmin.rows[0].minluftdruck;
    }

    let lat = query4.rows[0].breitengrad;
    let lon = query4.rows[0].laengengrad;
    const message = await req.consumeFlash('error');
    https.get(`https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=current,hourly,minutely,alerts&units=metric&appid=${api_key}`,(resp) => {
        let data = '';
        // A chunk of data has been received.
        resp.on('data', (chunk) => {
            data += chunk;
        });

        // The whole response has been received. Print out the result.
        resp.on('end',  () => {
            let automated_data = JSON.parse(data)
            let day_array = automated_data.daily;
            for(let i = 0; i< 7; i++){
                let temp = day_array[i].temp.max;
                let wind = day_array[i].wind_speed;
                chartData[i] = [temp, wind]
            }
            let length = row_data.length
            res.render("station.pug", {error: message, chartData : chartData, dashboard_data : dashboard_data, data: row_data, length: length, session: req.session.user})
        });
    }).on("error", (err) => {
        console.log("Error: " + err.message);
    });
});

app.get("/stations/:id/remove_reading/:reading_id", async function (req, res) {
    if(!checklogedin(req,res)){
        return;
    }
    let id = req.params.id;
    let reading_id = req.params.reading_id;
    let query1 = await dbClient.query("SELECT * FROM wetterstationen")
    let real_id = query1.rows[id].id;
    let query2 = await dbClient.query("SELECT * FROM readings WHERE stationen_id=$1",[real_id])
    if(query2.rows.length === 0){
        res.redirect("/stations/"+id+"/");
        return
    }
    let length = query2.rows.length;
    let real_reading_id = query2.rows[(length - 1 -reading_id)].id;
    let query3 = await dbClient.query("DELETE FROM readings WHERE stationen_id=$1 AND readings.id=$2", [real_id, real_reading_id])
    res.redirect("/stations/"+id+"/");
});

app.post("/add", urlencodedparser, async function (req, res){
    let wetterstation = req.body.neue_wetterstation;
    let laengengrad = req.body.laengengrad;
    let breitengrad = req.body.breitengrad;
    if(laengengrad === "" || breitengrad === "" || wetterstation === ""){
        res.redirect("dashboard")
        return
    }
    let query1 = await dbClient.query("INSERT INTO wetterstationen (wetterstation, laengengrad, breitengrad) VALUES ($1, $2, $3)",[wetterstation, laengengrad, breitengrad])
    res.redirect("dashboard");
});

app.post("/stations/:id/add_reading",urlencodedparser ,async (req, res) => {
    let id = req.params.id;
    let wetter = req.body.wetter;
    wetter = Math.round(wetter/100) * 100;
    let temperatur = req.body.temperatur;
    let wind = req.body.wind;
    let windrichtung = req.body.windrichtung;
    let luftdruck = req.body.luftdruck;
    if(wetter <= 100 || wetter === 400 || wetter >= 900 ||wind < 0 || windrichtung < 0 || windrichtung > 360 || luftdruck < 600){
        error = "Fehlerhafte Wetterdaten"
        await req.flash('error', error)
        res.redirect("/stations/"+id+ "/")
    }
    else{
        let zeitpunkt = new Date(Date.now())
        dbClient.query("SELECT * FROM wetterstationen", function (dbError, dbResponse) {
            let data = dbResponse.rows[id];
            let real_id = data.id;
            dbClient.query("INSERT INTO readings (stationen_id,zeitpunkt, wetter, temperatur, wind, luftdruck, windrichtung) VALUES ($1, $2, $3, $4, $5, $6, $7)", [real_id, zeitpunkt, wetter, temperatur, wind, luftdruck, windrichtung], function (dbError, dbResponse) {
                if(dbError)
                    console.log(dbError)
                res.redirect("/stations/"+id+ "/")
            })
        });
    }

});

app.post("/login", urlencodedparser, async (req, res)=>{
   let email = req.body.email;
   let password = req.body.password;
   let data = await dbClient.query("SELECT password FROM userdata WHERE email = $1", [email]);
   let error;
   if(data.rows.length === 0) {
       error = "Falscher Benutzername oder Passwort"
       await req.flash('error', error)
   }
   else{
       if(data.rows[0].password === password){
           req.session.user = email;
       }
       else{
           error = "Falscher Benutzername oder Passwort"
           await req.flash('error', error)
       }
   }
   res.redirect("/");
});
app.get("/signup", async (req, res) =>{
    const message = await req.consumeFlash('login_error');
    if(message.length === 0){
        res.render("signup.pug", {session : req.session.user});
    }
    else{
        res.render("signup.pug", {session : req.session.user, error: message});
    }
});

app.post("/signup/new_user", urlencodedparser, async (req, res) =>{
    let email = req.body.email;
    let vorname = req.body.vorname;
    let nachname = req.body.nachname;
    let password = req.body.password;
    try {
        await dbClient.query("INSERT INTO userdata (email, vorname, nachname, password) VALUES ($1,$2,$3,$4)", [email, vorname, nachname, password]);
    }
    catch(err){
        console.log(err)
        let error = "Email existiert schon"
        await req.flash('login_error', error)
        res.redirect("/signup")
        return
    }
    res.redirect("/");
});

app.get("/logout", (req, res) =>{
    if(!checklogedin(req,res)){
        return;
    }
    req.session.destroy(function (err){
    })
    res.redirect("/");
})

app.get("/stations/:id/add_automated_reading", async (req, res) =>{
    if(!checklogedin(req,res)){
        return;
    }
    let id = req.params.id;
    let query1 = await dbClient.query("SELECT * FROM wetterstationen")
    let real_id = query1.rows[id].id;
    let query2 = await dbClient.query("SELECT laengengrad, breitengrad FROM wetterstationen WHERE id = $1", [real_id])
    let lat = query2.rows[0].breitengrad;
    let lon = query2.rows[0].laengengrad;
    https.get(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}2&appid=${api_key}`, (resp) => {
        let data = '';
        // A chunk of data has been received.
        resp.on('data', (chunk) => {
            data += chunk;
        });

        // The whole response has been received. Print out the result.
        resp.on('end', async () => {
            let automated_data = JSON.parse(data)
            let wetter = automated_data.weather[0].id;
            wetter = Math.round(wetter/100) * 100;
            let temperatur = automated_data.main.temp - Kelvin;
            temperatur = temperatur.toFixed(2)
            let wind = automated_data.wind.speed;
            let windrichtung = automated_data.wind.deg;
            let luftdruck = automated_data.main.pressure;
            let zeitpunkt = new Date(Date.now())

            await dbClient.query("INSERT INTO readings (stationen_id,zeitpunkt, wetter, temperatur, wind, luftdruck, windrichtung) VALUES ($1, $2, $3, $4, $5, $6, $7)", [real_id, zeitpunkt, wetter, temperatur, wind, luftdruck, windrichtung])
            res.redirect("/stations/"+ id+ "/");
        });

    }).on("error", (err) => {
        console.log("Error: " + err.message);
    });

});
app.listen(PORT, function () {
    console.log(`Weathertop running and listening on port ${PORT}`);
});

function convertWeatherData(number){
    switch(number){
        case 200:
            return ["bi bi-cloud-lightning-rain text-warning", "Gewitter"];
        case 300:
            return ["bi bi-cloud-drizzle text-primary", "Nieselregen"]
        case 500:
            return ["bi bi-cloud-rain-heavy text-primary", "Regen"]
        case 600:
            return ["bi bi-snow text-primary", "Schnee"]
        case 700:
            return ["bi bi-cloud-haze text-primary", "Nebel"]
        case 800:
            return ["bi bi-brightness-high text-warning", "Sonnig"]
    }
}

function convertWindrichtung(windrichtung_grad){
    if(windrichtung_grad < 11.25)
        return "Norden"
    if(windrichtung_grad < 33.75)
        return "Nord Nord Ost"
    if(windrichtung_grad < 56.25)
        return "Nord Ost"
    if(windrichtung_grad < 78.75)
        return "Ost Nord Ost"
    if(windrichtung_grad < 101.25)
        return "Osten"
    if(windrichtung_grad < 123.75)
        return "Ost Süd Ost"
    if(windrichtung_grad < 146.25)
        return "Süd Ost"
    if(windrichtung_grad < 168.75)
        return "Süd Süd Ost"
    if(windrichtung_grad < 191.25)
        return "Süden"
    if(windrichtung_grad < 213.75)
        return "Süd Süd West"
    if(windrichtung_grad < 236.25)
        return "Süd West"
    if(windrichtung_grad < 258.75)
        return "West Süd West"
    if(windrichtung_grad < 281.25)
        return "Westen"
    if(windrichtung_grad < 303.75)
        return "West Nord West"
    if(windrichtung_grad < 326.25)
        return "Nord West"
    if(windrichtung_grad < 348.75)
        return "Nord Nord West"
    if(windrichtung_grad <= 360)
        return "Norden"
}


function checklogedin(req, res){
    if(req.session.user === undefined){
        res.redirect("/");
        return false;
    }
    return true;
}
