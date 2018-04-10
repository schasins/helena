# usage: python runHelenaScriptDistributed.py <helenaScriptNumericId> <numDistributedMachines> <timeoutInHours> <howManyRunsToAllowPerWorker>
# ex: python runHelenaScriptDistributed.py 1022 24 helena-1
# ex: python runHelenaScriptDistributed.py 1153 15 helena-2
# ex: python runHelenaScriptDistributed.py 1162 24 helena-2

import paramiko
import boto3
import sys
import pprint
import requests
import multiprocessing

scriptName = int(sys.argv[1])
timeoutInHours = float(sys.argv[2])
tag = sys.argv[3]

debug = False

#tag = "helena-1"

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
exit()

# the function that will actually talk to a given machine at a given index in the list of ips
def talkToOneDistributedMachine(i):
	ip = availableIps[i]
	if debug: print "ip", ip
	#k = paramiko.RSAKey.from_private_key_file("/Users/schasins/.ssh/MyKeyPair.pem")
	k = paramiko.RSAKey.from_private_key_file("/Users/sarahchasins/.ssh/MyKeyPair.pem")
	c = paramiko.SSHClient()
	c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
	if debug: print "connecting"
	c.connect( hostname = ip, username = "ec2-user", pkey = k )
	if debug: print "connected"
	# below, 1 is fixed because for now we only set one browser instance going on any given distributed machine
	# also all our amazon images have chromedriver in the same folder where we run, thus the hardcoded chromedriver loc
	com = "python runHelenaScriptInParallel.py " + str(scriptName) + " 1 " + str(timeoutInHours) + " 1 ./chromedriver " + str(runIdsForThisStage[i]) + ")"
	commands = ['(cd helena/utilities;' + com]
	for command in commands:
	    print "Executing {}".format( command )
	    stdin , stdout, stderr = c.exec_command(command)
	    print stdout.read()
	    print( "Errors")
	    print stderr.read()
	c.close()
	print "finished one thread for: ", runIdsForThisStage[i]

# all right, now we know all the ips available to us.  let's give some out
#pool = multiprocessing.Pool(numDistributedMachines)
#pool.map(talkToOneDistributedMachine, range(0, numDistributedMachines))

stages = [[8], [6], [1,2,4]]
#stages = [[3], [2,1]]
for stage in stages:
	runIdsForThisStage = []
	if debug: print "-----"
	for numMachines in stage:
		# make a new id for this run of numMachines machines
		# before we can do anything else, we need to get the dataset id that we'll use for all of the 'threads'
		# 'http://kaofang.cs.berkeley.edu:8080/newprogramrun', {name: dataset.name, program_id: dataset.program_id}
		r = requests.post('http://kaofang.cs.berkeley.edu:8080/newprogramrun', data = {"name": str(scriptName)+"_"+str(numMachines)+"_distributed_hashBased", "program_id": scriptName})
		output = r.json()
		runid = output["run_id"]
		if debug: print "generating run's dataset id:", runid, numMachines
		for i in range(numMachines):
			runIdsForThisStage.append(runid)
	if (len(runIdsForThisStage) > len(availableIps)):
		print "Woah, tried to do a stage that has more machines running in parallel than we have machines.  Fix."
		exit(1)
	# ok, we have all the ips we want and we know which set of machines is going to be working on which runs
	numMachinesWeActuallyWant = len(runIdsForThisStage)
	pool = multiprocessing.Pool(numMachinesWeActuallyWant)
	pool.map(talkToOneDistributedMachine, range(0, numMachinesWeActuallyWant))
	with open("runids.txt", "a") as myfile:
		for id in list(set(runIdsForThisStage)):
			myfile.write(str(id) + "\n")



