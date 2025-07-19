#!/usr/bin/env node

const {Cam} = require('onvif');
const fetch = require('node-fetch');
const {ArgumentParser} = require('argparse');
const pjson = require('./package.json');
const YAML = require('yaml')
const fs = require('fs');
let DEBUG_MODE = false;

class ZoneminderService {
  constructor(args) {
    this.basePath = args.url;
    this.username = args.username;
    this.password = args.password;
    this.token = null;
    this.refresh = null;
    this.tokenExpire = null;
    this.refreshExpire = null;

    this.requestQueue = new Array();
    this.queueRunning = false;
    this.servers = {};
    this.monitors = {};

    const that = this;
    this.addToQueue(function() {debug('load servers');that.loadServers()});
  }

  addToQueue(func) {
	  // debug('Add to queue');
    this.requestQueue.push(func);
    this.processQueue();
  }

  async processQueue() {
	  // debug('start process queue');
    if (this.queueRunning || this.requestQueue.length == 0) {
	    // debug(`skipping run: ${this.queueRunning} ${this.requestQueue.length}`);
      return;
    }

    this.queueRunning = true;
	  // debug('running queue');
    // const token = await this.getToken();
    while (this.requestQueue.length > 0) {
      // Make sure the token is up to date
      await this.getToken();
	    // debug(`queue size: ${this.requestQueue.length}`);
      await (this.requestQueue.shift())();
    }
    this.queueRunning = false;

    // Process the queue again just to make sure something wasn't added
    this.processQueue();
  }

  async fetchData(...args) {
	  debug('fetch')
	  debug(...args);
    let resp = await fetch(...args);

    // Keep retring if there is a 504 error code
    while (!resp.ok && resp.status == 504) {
      debug('Timeout fetching '+url);
      resp = await fetch(...args);
    }
	  debug(resp);

    return resp;
  }

  async getToken() {
	  // debug(this);
    // Check to see if the toek is expired?
    const now = Date.now();
	  // debug('getToken');
    if (!this.tokenExpire == null || now >= this.tokenExpire) {
      const params = new URLSearchParams();
      const url = this.basePath + "api/host/login.json";
	    // debug('login url: '+url);
      // Is the expire token still valid?
      if (now > this.refreshExpire) {
        params.append('username', this.username);
        params.append('password', this.password);
      } else {
        params.append('token', this.refresh);
      }
	    // debug(params);
	    debug('requesting new token');
      const resp = await this.fetchData(url, {method: 'POST', body: params});
	    // debug(resp);
      const body = await resp.json();

	    debug('token retrieved');
      // debug(body);

      this.token = body.access_token;
      this.tokenExpire = now + body.access_token_expires * 900;
      if (body.hasOwnProperty('refresh_token')) {
        this.refresh = body.refresh_token;
        this.refreshExpire = now + body.refresh_token_expires * 900;
      }
    }

	  // debug('returning token '+this.token);
    return this.token;
  }
  
  async loadServers() {
	  // debug('async servers');
	  // debug(this);
    const token = await this.getToken();
    const url = this.basePath+ 'api/servers.json?token='+token;
	  // debug(url);
    const resp = await this.fetchData(url);
    const data = await resp.json();

	  // debug(data);
	  for(var i in data.servers) {
		  const server = data.servers[i].Server;
		  // debug(data.servers[i].Server);
		  this.servers[server.Id] = server.Protocol + '://'+server.Hostname+':'+server.Port+server.PathToApi;
	}
	// debug(this.servers);
  }
	
  async readMonitorData(monitorId) {
	  // debug('async monitor '+monitorId);
	  // debug(this);
    const token = await this.getToken();
    const url = this.basePath+ 'api/monitors/'+monitorId+'.json?token='+token;
	  // debug(url);
    const resp = await this.fetchData(url);
    const data = await resp.json();

	  // debug('monitor '+monitorId);
	  // debug(data);
	  // debug('monitor level 1');
	  // debug(data.monitor);
	  // debug('monitor level 2');
	  // debug(data.monitor.Monitor);
	  this.monitors[monitorId] = data.monitor.Monitor.ServerId;
	  // debug(this.monitors);
  }

  getMonitorData(monitorId) {
	  // debug('request data for monitor '+monitorId);
	  // debug(this);
	  const that = this;
    this.addToQueue(async function() {
	    // debug(`getMonitorData(${monitorId})`);
	    // debug(that);
	    await that.readMonitorData(monitorId);
    });
  }

  /**
   * @param {number} monitorId
   * @param {boolean} state
   */
  setAlarm(monitorId, state) {
    debug(`Setting monitor ${monitorId} to state ${state}`);
    // Make sure current monitor data is loaded
    this.getMonitorData(monitorId);

    const that = this;
    const cmd = state ? 'on' : 'off';
    this.addToQueue(async function() {
	    // debug(`async setAlarm(${monitorId},${state})`);
      const serverId = that.monitors[monitorId];
	     // debug(monitorId);
	     // debug(that.monitors);
	     // debug(serverId);
      const baseUrl = that.servers[serverId];
	     // debug(that.servers);

      const url = `${baseUrl}/monitors/alarm/id:${monitorId}/command:${cmd}.json?token=${that.token}`;
	     // debug('trigger url: '+url);
      const resp = await that.fetchData(url);
      const body = await resp.json();
       // debug('trigger response body:');
	     // debug(body);
    });
  }
}

let MotionTopic = {
  CELL_MOTION_DETECTOR: 'CELL_MOTION_DETECTOR',
  MOTION_ALARM: 'MOTION_ALARM',
};

class Monitor {
  constructor(label, id, onvifCam, zoneminder) {
    this.id = id;
    this.label = label;
    this.onvifCam = onvifCam;
    this.zoneminder = zoneminder;
    this.lastMotionDetectedState = null;
    this.topic = MotionTopic.MOTION_ALARM;

	  // zoneminder.getMonitorData(id);
  }

  log(msg, ...rest) {
    debug(`[monitor ${this.label} (${this.id})]: ${msg}`, ...rest);
  }

  async start() {
    this.onvifCam.on('event', camMessage => this.onEventReceived(camMessage));
    this.log('Started');
  }

  onEventReceived(camMessage) {
    const topic = camMessage.topic._;
    if (topic.match(/RuleEngine\/CellMotionDetector\/Motion$/)) {
      this.onMotionDetectedEvent(camMessage);
    }
  }

  onMotionDetectedEvent(camMessage) {
    let isMotion = camMessage.message.message.data.simpleItem.$.Value;
    if (this.lastMotionDetectedState !== isMotion) {
      this.log(`CellMotionDetector: Motion Detected: ${isMotion}`);
      this.zoneminder.setAlarm(this.id, isMotion);

      // If this was a trigger, immediately turn if off again
      if(isMotion) {
	isMotion = false;
	this.zoneminder.setAlarm(this.id, isMotion);
      }
    }
    this.lastMotionDetectedState = isMotion
  }

  static createCamera(conf) {
    return new Promise(resolve => {
      const cam = new Cam(conf, () => resolve(cam));
    })
  }

  static async create({label, id, hostname, username, password, port}, zoneminder) {
    const cam = await this.createCamera({
      hostname,
      username,
      password,
      port
    });
    return new Monitor(label, id, cam, zoneminder);
  }
}

async function start(args) {
  // Parse the config file
  if(args.debug) {
    DEBUG_MODE = true;
  }

  const file = fs.readFileSync(args.config, 'utf8');
  const config = YAML.parse(file);
  const zoneminder = new ZoneminderService(config.zoneminder);
  const cameras = new Array();
  for(i in config.cameras) {
   const cam = config.cameras[i];
   const monitor = await Monitor.create({
    label: cam.label,
    id: cam.id,
    hostname: cam.address,
    username: cam.username,
    password: cam.password,
    port: cam.port ? cam.port : 80,
   }, zoneminder);
   // Force the camera to be off
   zoneminder.setAlarm(cam.id, false);
   monitor.start();
   cameras.push(monitor);
  }
}

function debug(...args) {
  if(DEBUG_MODE) {
    console.log(...args);
  }
}

function main() {
  const parser = new ArgumentParser({
    addHelp: true,
    description: 'ONVIF motion detection events bridge to Zoneminder',
    version: pjson.version,
  });

  parser.addArgument(['-c', '--config'], {
    help: 'Configuration YAML file',
    required: true
  });
  parser.addArgument(['-d', '--debug'], {action: 'storeTrue'}); 
  const args = parser.parseArgs();

  start(args);
}

main();
