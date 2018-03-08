import paramiko
import boto3

tag = "helena-1"

ec2 = boto3.client('ec2')  
tags = [{  
    'Name': 'tag:' + tag,
    'Values': ['true']
    }]
reservations = ec2.describe_instances(Filters=tags)
ip = reservations["Reservations"][0]["Instances"][0]["PublicIpAddress"]

k = paramiko.RSAKey.from_private_key_file("/Users/schasins/.ssh/MyKeyPair.pem")
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print "connecting"
c.connect( hostname = ip, username = "ec2-user", pkey = k )
print "connected"
commands = ['(cd helena/utilities; python runHelenaScriptInParallel.py 1022 1 1 1 ./chromedriver)']
for command in commands:
    print "Executing {}".format( command )
    stdin , stdout, stderr = c.exec_command(command)
    print stdout.read()
    print( "Errors")
    print stderr.read()
c.close()