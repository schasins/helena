# usage: python runHelenaScriptDistributed.py <helenaScriptNumericId> <numDistributedMachines> <timeoutInHours> <howManyRunsToAllowPerWorker>
# ex: python runHelenaScriptDistributed.py 1022 24 helena-1
# ex: python runHelenaScriptDistributed.py 1153 15 helena-2
# ex: python runHelenaScriptDistributed.py 1162 24 helena-2

import paramiko
import boto3
import sys
import pprint
import requests
import StringIO
from threading import Timer
from multiprocessing import Process
import numpy as np
import time
import socket

scriptName = int(sys.argv[1])
timeoutInHours = float(sys.argv[2])
tag = sys.argv[3]

debug = False

fname = "/Users/schasins/.ssh/homemac.pem"
f = open(fname,'r')
s = f.read()
keystring = StringIO.StringIO(s)

paramiko.util.log_to_file("paramiko.log")

ec2 = boto3.client('ec2', region_name='us-west-2')  
tags = [{  
    'Name': 'tag:' + tag,
    'Values': ['true']
    }]
reservations = ec2.describe_instances(Filters=tags)
#pp = pprint.PrettyPrinter(indent=1)
#pp.pprint(reservations)

# what machines do we have available to us?  let's get their ips
availableIps = []
runIdsForThisStage = []
timeouts = []
reservationsDeets = reservations["Reservations"]
l = len(reservationsDeets)
for i in range(l):
	instances = reservationsDeets[i]["Instances"]
	for j in range(len(instances)):
		if (not "PublicIpAddress" in instances[j]):
			# this one doesn't have a public ip address, probably because it's not running right now
			continue
		ip = instances[j]["PublicIpAddress"]
		availableIps.append(ip)

print availableIps

# the function that will actually talk to a given machine at a given index in the list of ips
class TalkToOneDistributedMachine(Process):

	def __init__(self, i):
			super(TalkToOneDistributedMachine,self).__init__()
			self.i = i

	def run(self):
			i = self.i

			ip = availableIps[i]
			if debug: print "ip", ip

			try:
				k = paramiko.RSAKey.from_private_key(keystring)
				#k = paramiko.RSAKey.from_private_key_file("/Users/sarahchasins/.ssh/MyKeyPair.pem")
				c = paramiko.SSHClient()
				c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
				if debug: print "connecting"
				c.connect( hostname = ip, username = "ec2-user", pkey = k )
				if debug: print "connected"
				# below, 1 is fixed because for now we only set one browser instance going on any given distributed machine
				# also all our amazon images have chromedriver in the same folder where we run, thus the hardcoded chromedriver loc
				com = "python runHelenaScriptInParallel.py " + str(scriptName) + " 1 " + str(timeouts[i]) + " 1 ./chromedriver " + str(runIdsForThisStage[i]) + ")"
				commands = ['(cd helena/utilities;' + com]
				for command in commands:
				    print "Executing {}".format( command )
				    stdin , stdout, stderr = c.exec_command(command)
				    print stdout.read()
				    print( "Errors")
				    print stderr.read()
				c.close()
				print "finished one thread for: ", runIdsForThisStage[i]
			except (paramiko.SSHException, socket.error) as e:
				print "SSH exception, gross"
				print e
				time.sleep(5)
				return self.run()

def joinProcessesCustom(procs):
	pnum = len(procs)
	bool_list = [True]*pnum
	while True:
		for i in range(pnum):
				bool_list[i] = procs[i].is_alive()
		if np.all(bool_list):
				# ok, they're all still active; come back later
				# print "all still active"
				time.sleep(5)
		else:
				print "one is done!"
				# ok, at least one is done.  we want to cut off in x minutes
				threshold = 20 * 60 # 20 minutes seems reasonable.  no thread should be going 20 mins after others for our distributed experiments (obviously not true in general case)
				return joinProcessesTimeout(procs, threshold)

def joinProcessesTimeout(procs, timeoutInSeconds):
	pnum = len(procs)
	bool_list = [True]*pnum
	start = time.time()
	while time.time() - start <= timeoutInSeconds:
		for i in range(pnum):
				bool_list[i] = procs[i].is_alive()
		if np.any(bool_list):
				time.sleep(5)
		else:
				print "time to finish: ", time.time() - start
				return True
	else:
		print "timed out, killing all processes", time.time() - start
		for p in procs:
				p.terminate()
				p.join()
		return False


stages = [{"workers":[8],"cutoff": True}, 
			{"workers":[6],"cutoff": True}, 
			{"workers": [1,2,4],"cutoff":False}
		]
#stages = [[3], [2,1]]
for stage in stages:
	global pool
	cutoff = stage["cutoff"]
	runIdsForThisStage = []
	timeouts = []
	if debug: print "-----"
	for numMachines in stage["workers"]:
		# make a new id for this run of numMachines machines
		# before we can do anything else, we need to get the dataset id that we'll use for all of the 'threads'
		# 'http://kaofang.cs.berkeley.edu:8080/newprogramrun', {name: dataset.name, program_id: dataset.program_id}
		r = requests.post('http://kaofang.cs.berkeley.edu:8080/newprogramrun', data = {"name": str(scriptName)+"_"+str(numMachines)+"_distributed_lockBased", "program_id": scriptName})
		output = r.json()
		runid = output["run_id"]
		if debug: print "generating run's dataset id:", runid, numMachines
		for i in range(numMachines):
			runIdsForThisStage.append(runid)
			timeouts.append(timeoutInHours/numMachines)
	if (len(runIdsForThisStage) > len(availableIps)):
		print "Woah, tried to do a stage that has more machines running in parallel than we have machines.  Fix."
		exit(1)
	# ok, we have all the ips we want and we know which set of machines is going to be working on which runs
	numMachinesWeActuallyWant = len(runIdsForThisStage)

	procs = []
	for i in range(numMachinesWeActuallyWant):
		p = TalkToOneDistributedMachine(i)
		procs.append(p)
		p.start()
		time.sleep(.3)
	
	if cutoff:
		# if we want to cut off all straggler processes when most processes are done, we'll use joinProcessesCustom
		joinProcessesCustom(procs)
	else:
		joinProcessesTimeout(procs, timeoutInHours * 60 * 60)

	with open("runids.txt", "a") as myfile:
		for id in list(set(runIdsForThisStage)):
			myfile.write(str(id) + "\n")



