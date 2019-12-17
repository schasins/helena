--------------------------------------
Quick start guide:
--------------------------------------

No need to even download or clone this repository!

(1) If not yet installed, install docker: 

https://www.docker.com/get-started

(2) Start the program with the run command, for example: 

docker run -t -p 5900:5900 -e VNC_SERVER_PASSWORD=password -e HELENA_PROGRAM_ID=2357 -e TIME_LIMIT_IN_HOURS=23 -e NUM_RUNS_ALLOWED_PER_WORKER=1 --user apps --privileged schasins/helena:latest

Or if you want to pass parameters:

docker run -t -p 5900:5900 -e VNC_SERVER_PASSWORD=password -e HELENA_PROGRAM_ID=4249 -e TIME_LIMIT_IN_HOURS=23 -e NUM_RUNS_ALLOWED_PER_WORKER=1  -e SCRIPT_PARAMS="test=this is a string" --user apps --privileged schasins/helena:latest

Note that this command will run slowly the first time but faster after the first run.

--------------------------------------
Alternative quick start guide if you need to run a parallelized Helena program:
--------------------------------------

(1) If not yet installed, install docker: https://www.docker.com/get-started

(2) Install python 2.7: https://www.python.org/downloads/

(3) Download the python script for starting parallel Dockers: wget https://github.com/schasins/helena-docker/raw/master/startHelenaDockers.py

(4) Start the program with the run command, for example: python startHelenaDockers.py --id=3597

(5) For help or for more information about options, including how to run with multiple parallel workers: python startHelenaDockers.py -h

--------------------------------------
For developers:
--------------------------------------

docker run -t -p 5900:5900 -e VNC_SERVER_PASSWORD=password -e HELENA_PROGRAM_ID=2357 -e TIME_LIMIT_IN_HOURS=23 -e NUM_RUNS_ALLOWED_PER_WORKER=1 --user apps --privileged local/helena:0.0.1

run in utilities dir:
./make-crx.sh ../src ../src.pem

run in top-level dir:
docker build -t local/helena:0.0.1 .

docker kill $(docker ps -q)

docker save --output helena-image.tar local/helena:0.0.1

docker load --input helena-image.tar

wget https://github.com/schasins/helena-docker/raw/master/helena-image.tar

open vnc://localhost:5900

--------------------------------------
To push a new version to Docker Hub:
--------------------------------------

docker login --username <username> --password <password>

docker tag local/helena:0.0.1 schasins/helena

docker push schasins/helena
