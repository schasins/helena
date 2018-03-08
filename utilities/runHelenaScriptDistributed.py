import boto3
import botocore

def execute_commands_on_linux_instances(client, commands, tag):
    """Runs commands on remote linux instances
    :param client: a boto/boto3 ssm client
    :param commands: a list of strings, each one a command to execute on the instances
    :param instance_ids: a list of instance_id strings, of the instances on which to execute the command
    :return: the response from the send_command function (check the boto3 docs for ssm client.send_command() )
    """

    resp = client.send_command(
        DocumentName="AWS-RunShellScript", # One of AWS' preconfigured documents
        Parameters={'commands': commands},
        Targets=[
            {
                'Key': "tag:" + tag,
                'Values': ["true"]
            }
        ]
    )
    return resp

client = boto3.client('ssm') # Need your credentials here
commands = ['echo "hello world"']
tag = "helena-1"
resp = execute_commands_on_linux_instances(client, commands, tag)
print resp