import express from "express";
import http from "http";
import https from "https";
import { open } from "fs/promises";

const APIKey = process.env.DH_API_KEY || "";
const IntervalSeconds = process.env.INTERVAL_SECONDS || 600;
const NamesFilepath = process.env.NAMES_FILEPATH || './dns-names.lines';

const healthPort = 6363;

function getRequest(url, callback) {

    https.get(url, (res) => {

        let data = ''
        res.on('data', chunk => {
            data += chunk;
        });

        res.on('end', () => {
            callback(data);
        });
    });
}

function getExternalIP(callback) {

    console.log("Getting external IP address...");

    getRequest("https://api.ipify.org?format=json", (data) => {

        const ip = JSON.parse(data)["ip"];
        console.log(`Got ${ip}.`);
        callback(ip);
    });
}

function getEntries(callback) {

    console.log("Getting DNS records list...");

    getRequest("https://api.dreamhost.com/?key=" + APIKey + "&cmd=dns-list_records", (data) => {

        let nameToIP = {};
        const ExtractHostIPExp = /^\d+\W[\w.]+\W([\w.]+)\W(\w+)\W([\d.]+)/gm;

        let matchItr = data.matchAll(ExtractHostIPExp);
        let matches = [...matchItr];

        console.log(`Got ${matches.length} records.`);
        matches.forEach((match) => {
            nameToIP[match[1]] = { type: match[2], value: match[3] };
        });

        callback(nameToIP);
    });
}

function updateEntries(hosts, ip) {

    getEntries((entries) => {
        
        hosts.forEach((hostname) => {

            if(!Object.hasOwn(entries, hostname))
                return;

            if(entries[hostname].value == ip)
                return;

            console.log(`Updating ${hostname}...`);

            getRequest(`https://api.dreamhost.com/?key=${APIKey}&cmd=dns-remove_record&record=${hostname}&type=${entries[hostname].type}&value=${entries[hostname].value}`, (data) => {
                
                console.log(`Removed ${hostname} ${entries[hostname].type} ${entries[hostname].value}.`);

                getRequest(`https://api.dreamhost.com/?key=${APIKey}&cmd=dns-add_record&record=${hostname}&type=${entries[hostname].type}&value=${ip}`, (data) => {
                
                    console.log(`Added ${hostname} ${entries[hostname].type} ${ip}.`);

                });
            });
        });
    });
}



const file = await open(NamesFilepath);
var dnsNames = [];

for await (const line of file.readLines()) {
    dnsNames.push(line);
}

console.log(`Using DNS Names: ${dnsNames}`);

const app = express();

// Simple health check endpoint
app.get('/health', (req, res) => {

  res.json({ status: 'OK' });

});

http.createServer(app).listen(healthPort);

getExternalIP((extIP) => {

    updateEntries(dnsNames, extIP);

});

console.log(`Starting poll, interval: ${IntervalSeconds}.`);

setInterval(()=> {

    getExternalIP((extIP) => {

        updateEntries(dnsNames, extIP);

    });

}, 1000 * IntervalSeconds);