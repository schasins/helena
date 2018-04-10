import paramiko
import boto3
import sys
import pprint
import requests
import multiprocessing

debug = True

tag = "helena-1"

ec2 = boto3.client('ec2', region_name='us-west-2')  
tags = [{  
    'Name': 'tag:' + tag,
    'Values': ['true']
    }]
reservations = ec2.describe_instances(Filters=tags)
pp = pprint.PrettyPrinter(indent=1)
pp.pprint(reservations)

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

if debug: print availableIps

for ip in availableIps:
	if debug: print "ip", ip
	k = paramiko.RSAKey.from_private_key_file("/Users/schasins/.ssh/homemac.pem")
	#k = paramiko.RSAKey.from_private_key_file("/Users/sarahchasins/.ssh/MyKeyPair.pem")
	c = paramiko.SSHClient()
	c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
	if debug: print "connecting"
	c.connect( hostname = ip, username = "ec2-user", pkey = k )
	if debug: print "connected"
	commands = ['(cd helena; git pull)', '(cd helena/src/scripts/lib/helena-library; git pull)']
	for command in commands:
	    print "Executing {}".format( command )
	    stdin , stdout, stderr = c.exec_command(command)
	    print stdout.read()
	    print( "Errors")
	    print stderr.read()
	c.close()