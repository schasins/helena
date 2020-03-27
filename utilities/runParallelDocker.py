# usage: python runParallelDocker.py <helenaScriptNumericId> <numParallelWorkers> <timeoutInHours> <howManyRunsToAllowPerWorker>
# ex: python runParallelDocker.py 1022 4 24 1
# after running, you can download with the standard download urls; e.g., http://helena-backend.us-west-2.elasticbeanstalk.com/datasets/4872/1

import sys
import requests
import subprocess

scriptId = int(sys.argv[1])
numParallelWorkers = int(sys.argv[2])
timeoutInHours = float(sys.argv[3])
numRunsAllowed = int(sys.argv[4])

r = requests.post('http://helena-backend.us-west-2.elasticbeanstalk.com/newprogramrun', data = {"program_id": scriptId})
output = r.json()
runid = output["run_id"]

processes = set()
for i in range(numParallelWorkers):
	port = 5900 + i
	command = ["docker","run","-t","-p",str(port)+":"+str(port),"-e","VNC_SERVER_PASSWORD=password","-e","HELENA_PROGRAM_ID="+str(scriptId),"-e","TIME_LIMIT_IN_HOURS="+str(timeoutInHours),"-e","NUM_RUNS_ALLOWED_PER_WORKER="+str(numRunsAllowed),"-e","HELENA_RUN_ID="+str(runid),"--user","apps","--privileged","schasins/helena:latest"]

	print "Executing {}".format(command)
	processes.add(subprocess.Popen(command))

for p in processes:
    if p.poll() is None:
        p.wait()