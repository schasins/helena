#!/bin/bash
set -euo pipefail
IFS=$'\n\t'

# Based on: http://www.richud.com/wiki/Ubuntu_Fluxbox_GUI_with_x11vnc_and_Xvfb

main() {
    log_i "Starting xvfb virtual display..."
    launch_xvfb
    log_i "Starting window manager..."
    launch_window_manager
    log_i "Starting VNC server..."
    run_vnc_server
    log_i "Starting Chrome..."
    run_chrome
}

launch_xvfb() {
    local xvfbLockFilePath="/tmp/.X1-lock"
    if [ -f "${xvfbLockFilePath}" ]
    then
        log_i "Removing xvfb lock file '${xvfbLockFilePath}'..."
        if ! rm -f -v "${xvfbLockFilePath}"
        then
            log_e "Failed to remove xvfb lock file"
            exit 1
        fi
    fi

    # Set defaults if the user did not specify envs.
    export DISPLAY=${XVFB_DISPLAY:-:1}
    local screen=${XVFB_SCREEN:-0}
    local resolution=${XVFB_RESOLUTION:-1280x960x24}
    local timeout=${XVFB_TIMEOUT:-5}

    # Start and wait for either Xvfb to be fully up or we hit the timeout.
    Xvfb ${DISPLAY} -screen ${screen} ${resolution} &
    local loopCount=0
    until xdpyinfo -display ${DISPLAY} > /dev/null 2>&1
    do
        loopCount=$((loopCount+1))
        sleep 1
        if [ ${loopCount} -gt ${timeout} ]
        then
            log_e "xvfb failed to start"
            exit 1
        fi
    done
}

launch_window_manager() {
    local timeout=${XVFB_TIMEOUT:-300}

    # Start and wait for either fluxbox to be fully up or we hit the timeout.
    fluxbox &
    local loopCount=0
    until wmctrl -m > /dev/null 2>&1
    do
        loopCount=$((loopCount+1))
        sleep 1
        if [ ${loopCount} -gt ${timeout} ]
        then
            log_e "fluxbox failed to start"
            exit 1
        fi
    done
}

run_vnc_server() {
    local noVnc=${NO_VNC:-0}
    if [ $noVnc -eq 0 ]
    then
        # x11vnc -display ${DISPLAY} -forever -nopw &
        x11vnc -display ${DISPLAY} -forever -passwd password &
    fi
}

run_chrome() {
    local extensionid=${HELENA_EXTENSION_ID}
    local progid=${HELENA_PROGRAM_ID:-2356}
    local runid=${HELENA_RUN_ID}
    local timelimit=${TIME_LIMIT_IN_HOURS:-23}
    local numruns=${NUM_RUNS_ALLOWED_PER_WORKER:-1}
    local server=${HELENA_SERVER_URL:-"http://helena-backend.us-west-2.elasticbeanstalk.com"}
    local batchsize=${ROW_BATCH_SIZE:-10}
    google-chrome --version
    echo Extension ID: $extensionid
    python loadAndSaveProgram.py ${server} ${extensionid} ${progid}
    # python recordNewProgram.py ${server} ${extensionid} ${progid}
    python recordNewProgram2.py ${server} ${extensionid} ${progid}
    python runHelenaScript.py ${extensionid} ${progid} ${runid} ${timelimit} ${numruns} ${server} ${batchsize}
}

log_i() {
    log "[INFO] ${@}"
}

log_w() {
    log "[WARN] ${@}"
}

log_e() {
    log "[ERROR] ${@}"
}

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ${@}"
}

control_c() {
    echo ""
    exit
}

trap control_c SIGINT SIGTERM SIGHUP

main
