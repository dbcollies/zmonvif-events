# zmonvif-events

A JS CLI tool that attempts to bridge the gap between your ONVIF cameras' motion detection and Zoneminder.

Forked from [zmonvif-events](https://github.com/nickw444/zmonvif-events).


## Why?
In a typical Zoneminder installation the server will do video processing to determine which frames have motion. Unfortunately this task is quite CPU intensive. 

Fortunately some ONVIF cameras have built in motion detection features, which notify subscribers when an event occurs. 

This tool connects to multiple ONVIF cameras and subscribes to these messages. When the motion state changes, it uses Zoneminder's API to arm the selected monitors

## Install

```bash
npm install -g zmonvif-events
```

## Usage

```bash
zmonvif-events --help
usage: zmonvif-events [-h] -c configfile.yaml


ONVIF motion detection events bridge to Zoneminder

Arguments:
  -h, --help            Show this help message and exit.
  -v, --version         Show program's version number and exit.
  -c CONFIGFILE, --config CONFIGFILE
                        Configuration YAML file
```
**Example Config File**
```bash
zoneminder:
    url: http://ZONEMINDER_SERVER/zm/ # The URL to Zoneminder
    username: zmusername              # Username to log in to zoneminder
    password: ZMPassword              # Password to log in to zoneminder

cameras:                              # A list of cameras to monitor
    - label: porch                    # Label - used only for logging
      address: 192.168.0.100          # Address of the camera (name or IP)
      port: 8899                      # Port number (default: 80)
      username: camera1user           # User to log in to camera
      password: camera1password       # Password for camera
      id: 8                           # Zoneminder ID to trigger on motion
    - label: garage                   # A Second camera. Add as many as needed
      address: 192.168.0.101
      port: 80
      username: camera2user
      password: camera2password
      id: 6
```

**Example**

```bash
  zmonvif-events -c example.yaml
```
```
[monitor porch (8)]: Started
[monitor garage (6)]: Started
[monitor porch (8)]: CellMotionDetector: Motion Detected: true
Setting monitor 8 to state true
[monitor porch (8)]: CellMotionDetector: Motion Detected: false
Setting monitor 8 to state false
[monitor garage (6)]: CellMotionDetector: Motion Detected: true
Setting monitor 6 to state true
[monitor garage (6)]: CellMotionDetector: Motion Detected: false
```
