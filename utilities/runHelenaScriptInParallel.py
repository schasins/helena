# usage: python runHelenaScriptInParallel.py <helenaScriptNumericId> <numParallelBrowsers> <timeoutInHours> <howManyRunsToAllowPerWorker> <pathToChromeDriver>
# ex: python runHelenaScriptInParallel.py 651 3 23.75 1000 /home/username/Downloads/chromedriver
# ex: python runHelenaScriptInParallel.py 927 1 1 1 /Users/schasins/Downloads/chromedriver
# ex: python runHelenaScriptInParallel.py 927 1 1 1 ./chromedriver
# ex: python runHelenaScriptInParallel.py 945 3 23.75 1000 ./chromedriver
# ex: python runHelenaScriptInParallel.py 1012 1 1 1 ./chromedriver
# in the above, we want to let the script keep looping as long as it wants in 23.75 hours, so we put 1000 runs allowed
# it's probably more normal to only allow one run, unless you have it set up to loop forever

from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time
from sys import platform
import sys
from multiprocessing import Process, Queue
import traceback
import logging
import random
import requests
import numpy as np
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities  
import json
import os.path

scriptName = int(sys.argv[1])
numParallelBrowsers = int(sys.argv[2])
timeoutInHours = float(sys.argv[3])
howManyRunsToAllowPerWorker = int(sys.argv[4])
chromeDriverPath = sys.argv[5]

try:
	sys.argv[6]
except IndexError:
	helenaRunId = None
else:
	helenaRunId = sys.argv[6]

debug = False
headless = True

if headless:
	from pyvirtualdisplay import Display
	display = Display(visible=0, size=(800, 800))  
	display.start()

unpackedExtensionPath = "../src"
extensionkey = None
profilePath = "helenaProfile"

def getKeyFromFile(fname):
	if (not os.path.isfile(fname)):
		# ok, first we need to do something that will cause us to make this file
		chrome_options = Options()
		chrome_options.add_argument("--remote-debugging-port=9222")
		chrome_options.add_argument("--disable-gpu")
		chrome_options.add_argument('--no-sandbox')
		chrome_options.add_argument("--load-extension=" + unpackedExtensionPath)
		chrome_options.add_argument("user-data-dir=" + profilePath) # by insisting on using this profile, we get the fname to exist
		driver = webdriver.Chrome(chromeDriverPath, chrome_options=chrome_options, service_args=["--verbose", "--log-path=log.txt"])
		driver.close()

	f = open(fname, "r")
	data = json.load(f)
        # print data

        if not "extensions" in data:
                return None
	extensions = data["extensions"]["settings"]
	for extension in extensions:
		if "path" in extensions[extension]:
			path = extensions[extension]["path"]
			if "helena" in path:
				return extension
	return None

def newDriver(profile):
	chrome_options = Options()
	chrome_options.add_argument("--remote-debugging-port=9222")
	chrome_options.add_argument("--disable-gpu")
	chrome_options.add_argument('--no-sandbox')
	chrome_options.add_argument("--load-extension=" + unpackedExtensionPath)
	chrome_options.add_argument("user-data-dir=" + profilePath)
	# chrome_options.add_argument("--display=:0") 

	desired = DesiredCapabilities.CHROME
	desired ['loggingPrefs'] = { 'browser':'ALL' }

	driver = webdriver.Chrome(chromeDriverPath, chrome_options=chrome_options, service_args=["--verbose", "--log-path=log.txt"])

	try:
		driver.get("chrome://extensions/")
		checkbox = driver.find_element_by_id("toggle-dev-on")
		if (not checkbox.is_selected()):
			checkbox.click()
			time.sleep(1)

		elems = driver.find_elements_by_class_name("extension-details")
		for i in range(len(elems)):
			t = elems[i].text
			if ("Helena Scraper and Automator" in t):
				lines = t.split("\n")
				for line in lines:
					if "ID: " in line:
						key = line.strip().split("ID: ")[1]
						print "extension key:", key
						extensionkey = key
	except:
		fname = profilePath + "/Default/Secure Preferences"
		extensionkey = getKeyFromFile(fname)
		if not extensionkey:
			extensionkey = getKeyFromFile(profilePath + "/Default/Preferences")
		print extensionkey

	driver.get("chrome-extension://" + extensionkey + "/pages/mainpanel.html")
	return driver
	
def runScrapingProgramHelper(driver, progId, optionsStr):
	driver.execute_script("window.helenaMainpanel.UIObject.loadSavedProgram(" + str(progId) + ");")

	if debug:
		time.sleep(10)
		data = driver.get_log('browser')
		for line in data:
				print line

	runCurrentProgramJS = """
	function repeatUntilReadyToRun(){
		console.log("repeatUntilReadyToRun");
		// ringerUseXpathFastMode = true; // just for the peru one.  remove this later
		if (!window.helenaMainpanel.UIObject.currentHelenaProgram){
			setTimeout(repeatUntilReadyToRun, 1000);
		}
		else{
			window.helenaMainpanel.UIObject.currentHelenaProgram.runProgram(""" + optionsStr + """);
		}
	}
	repeatUntilReadyToRun();
	"""
	driver.execute_script(runCurrentProgramJS)
	print "started run"

def blockingRepeatUntilNonFalseAnswer(lam, driver):
	ans = lam()
	while (not ans):
		time.sleep(5)
		ans = lam()
		if debug:
			data = driver.get_log('browser')
			print "log so far"
			for line in data:
					print line
	return ans

def getDatasetIdForDriver(driver):
	getDatasetId = lambda : driver.execute_script("console.log('datasetsScraped', datasetsScraped); if (datasetsScraped.length > 0) {console.log('realAnswer', datasetsScraped[0]); return datasetsScraped[0];} else { return false;}")
	return blockingRepeatUntilNonFalseAnswer(getDatasetId, driver)

def getWhetherDone(driver):
	getHowManyDone = lambda: driver.execute_script("console.log('scrapingRunsCompleted', scrapingRunsCompleted); if (scrapingRunsCompleted < "+str(howManyRunsToAllowPerWorker)+") {return false;} else {return scrapingRunsCompleted}")
	return blockingRepeatUntilNonFalseAnswer(getHowManyDone, driver)

class RunProgramProcess(Process):

		def __init__(self, profile, programId, optionStr, numTriesSoFar=0):
				super(RunProgramProcess,self).__init__()

				self.profile = profile
				self.programId = programId
				self.optionStr = optionStr
				self.numTriesSoFar = numTriesSoFar
				self.driver = newDriver(self.profile)

		def run(self):
				self.runInternals()

		def runInternals(self):
				try:
					runScrapingProgramHelper(self.driver, self.programId, self.optionStr)
					done = getWhetherDone(self.driver)
					self.driver.close()
					self.driver.quit()
				except Exception as e:
						# assume we can just recover by trying again
						if (self.numTriesSoFar < 3):
								self.numTriesSoFar += 1
								self.runInternals()
						else:
								logging.error(traceback.format_exc())

		def terminate(self):
			try:
				if (self.driver):
					self.driver.close()
					self.driver.quit()
			except: # catch *all* exceptions
				print "tried to close driver but no luck. probably already closed"
				super(RunProgramProcess, self).terminate()


def joinProcesses(procs, timeoutInSeconds):
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
   

def oneRun(programId, threadCount, timeoutInSeconds, mode):
	noErrorsRunComplete = False
	id = None

	if (helenaRunId):
		# oh aweomse, someone gave us a run id as a command line argument (probably because we're being run disributed
		# and this machine is only running a subset of the threads)
		id = helenaRunId
	else:
		# ok, before we can do anything else, we need to get the dataset id that we'll use for all of the 'threads'
		# 'http://kaofang.cs.berkeley.edu:8080/newprogramrun', {name: dataset.name, program_id: dataset.program_id}
		r = requests.post('http://helena-backend.us-west-2.elasticbeanstalk.com/newprogramrun', data = {"name": str(programId)+"_"+str(threadCount)+"_noprofile_"+mode, "program_id": programId})
		output = r.json()
		id = output["run_id"]
	print "current parallel run's dataset id:", id

	procs = []
	for i in range(threadCount):
		optionStr = "parallel:true"
		if (howManyRunsToAllowPerWorker > 1):
			optionStr += ", restartOnFinish:true"
		if (mode == "hashBased"):
			# a more complicated param in this case
			optionStr = "hashBasedParallel: {on: true, numThreads: " + str(threadCount) + ", thisThreadIndex: " + str(i) + "}"
			# print optionStr
		p = RunProgramProcess(str(i), programId, '{' + optionStr + ', dataset_id: '+ str(id) +'}')
		procs.append(p)

	for p in procs:
		time.sleep(.02) # don't overload; also, wait for thing to load
		p.daemon = True
		p.start()
	
	# below will be true if all complete within the time limit, else false
	noErrorsRunComplete = joinProcesses(procs, timeoutInSeconds)
	return

def main():
		oneRun([scriptName], numParallelBrowsers, int(timeoutInHours * 60 * 60), "lockBased")

main()
exit()
