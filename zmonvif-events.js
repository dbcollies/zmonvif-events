#!/usr/bin/env node

const {Cam} = require('onvif');
const fetch = require('node-fetch');
const {ArgumentParser} = require('argparse');
const pjson = require('./package.json');
const YAML = require('yaml')
const fs = require('fs');

class ZoneminderService {
  constructor(args) {
    this.basePath = args.url;
    this.username = args.username;
    this.password = args.password;
  }

  /**
   * @param {number} monitorId
   * @param {boolean} state
   */
  setAlarm(monitorId, state) {
    console.log(`Setting monitor ${monitorId} to state ${state}`);
    const cmd = state ? 'on' : 'off';
    const url = `${this.basePath}api/monitors/alarm/id:${monitorId}/command:${cmd}.json?username=${this.username}&password=${this.password}`;
    // console.log(`fetching ${url}`);
    return fetch(url);
  }
}

let MotionTopic = {
  CELL_MOTION_DETECTOR: 'CELL_MOTION_DETECTOR',
  MOTION_ALARM: 'MOTION_ALARM',
};

class Monitor {
  constructor(id, onvifCam, zoneminder) {
    this.id = id;
    this.onvifCam = onvifCam;
    this.zoneminder = zoneminder;
    this.lastMotionDetectedState = null;
    this.topic = MotionTopic.MOTION_ALARM;
  }

  log(msg, ...rest) {
    console.log(`[monitor ${this.id}]: ${msg}`, ...rest);
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
    const isMotion = camMessage.message.message.data.simpleItem.$.Value;
    if (this.lastMotionDetectedState !== isMotion) {
      this.log(`CellMotionDetector: Motion Detected: ${isMotion}`);
      this.zoneminder.setAlarm(this.id, isMotion);
    }
    this.lastMotionDetectedState = isMotion
  }

  static createCamera(conf) {
    return new Promise(resolve => {
      const cam = new Cam(conf, () => resolve(cam));
    })
  }

  static async create({id, hostname, username, password, port}, zoneminder) {
    const cam = await this.createCamera({
      hostname,
      username,
      password,
      port
    });
    return new Monitor(id, cam, zoneminder);
  }
}

async function start(args) {
	console.log(args);
  // Parse the config file
  const file = fs.readFileSync(args.config, 'utf8');
  const config = YAML.parse(file);
  const zoneminder = new ZoneminderService(config.zoneminder);
  const cameras = new Array();
  for(i in config.cameras) {
   const cam = config.cameras[i];
   const monitor = await Monitor.create({
    id: cam.id,
    hostname: cam.address,
    username: cam.username,
    password: cam.password,
    port: cam.port ? cam.port : 80,
   }, zoneminder);
   monitor.start();
   cameras.push(monitor);
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
  const args = parser.parseArgs();

  start(args);
}

main();
