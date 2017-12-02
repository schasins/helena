from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time
from sys import platform
from multiprocessing import Process, Queue
import traceback
import logging
import numpy as np
import random
import requests

"""
from pyvirtualdisplay import Display
display = Display(visible=0, size=(800, 800))  
display.start()
"""

unpackedExtensionPath = "../src"


if platform == "linux" or platform == "linux2":
	# linux
	chromeDriverPath = '/home/schasins/Downloads/chromedriver'
	extensionkey = "clelgfmpjhkenbpdddjihmokjgooedpl"
elif platform == "darwin":
	# OS X
	chromeDriverPath = '/Users/schasins/Downloads/chromedriver'
	extensionkey = "bcnlebcnondcgcmmkcnmepgnamoekjnn"

def newDriver(profile):
	chrome_options = Options()
	chrome_options.add_argument("--load-extension=" + unpackedExtensionPath)
	# chrome_options.add_argument("user-data-dir=profiles/" + profile)
        chrome_options.add_argument("--display=:0") 

	driver = webdriver.Chrome(chromeDriverPath, chrome_options=chrome_options)

	driver.get("chrome-extension://" + extensionkey + "/pages/mainpanel.html")
	return driver

def runScrapingProgram(profile, progId, optionsStr):

	driver = newDriver(profile)
	runScrapingProgramHelper(driver, progId, optionsStr)

	return driver
	
def runScrapingProgramHelper(driver, progId, optionsStr):
	driver.execute_script("RecorderUI.loadSavedProgram(" + str(progId) + ");")

	runCurrentProgramJS = """
	function repeatUntilReadyToRun(){
		console.log("repeatUntilReadyToRun");
        // ringerUseXpathFastMode = true; // just for the peru one.  remove this later
		if (!ReplayScript.prog){
			setTimeout(repeatUntilReadyToRun, 100);
		}
		else{
			ReplayScript.prog.run(""" + optionsStr + """);
		}
	}
	repeatUntilReadyToRun();
	"""
	driver.execute_script(runCurrentProgramJS)
	

def blockingRepeatUntilNonFalseAnswer(lam):
	ans = lam()
	while (not ans):
		time.sleep(5)
		ans = lam()
	return ans

def getDatasetIdForDriver(driver):
	getDatasetId = lambda : driver.execute_script("console.log('datasetsScraped', datasetsScraped); if (datasetsScraped.length > 0) {console.log('realAnswer', datasetsScraped[0]); return datasetsScraped[0];} else { return false;}")
	return blockingRepeatUntilNonFalseAnswer(getDatasetId)

def getWhetherDone(driver):
	getHowManyDone = lambda: driver.execute_script("console.log('scrapingRunsCompleted', scrapingRunsCompleted); if (scrapingRunsCompleted === 0) {return false;} else {return scrapingRunsCompleted}")
	return blockingRepeatUntilNonFalseAnswer(getHowManyDone)

class RunProgramProcess(Process):

        def __init__(self, profile, programId, optionStr, numTriesSoFar=0):
                super(RunProgramProcess,self).__init__()

                self.profile = profile
                self.programId = programId
                self.optionStr = optionStr
                self.numTriesSoFar = numTriesSoFar
		self.driver = newDriver(self.profile)
                # below is bad, but I'm going to do it anyway for time being
                #self.driver = runScrapingProgram(self.profile, self.programId, self.optionStr)

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
   

def oneRun(programId, allDatasetsAllIterations, threadCount, timeoutInSeconds, mode):
	noErrorsRunComplete = False
	id = None

	while (not noErrorsRunComplete):

		# ok, before we can do anything else, we need to get the dataset id that we'll use for all of the 'threads'
		# 'http://kaofang.cs.berkeley.edu:8080/newprogramrun', {name: dataset.name, program_id: dataset.program_id}
		r = requests.post('http://kaofang.cs.berkeley.edu:8080/newprogramrun', data = {"name": str(programId)+"_"+str(threadCount)+"_noprofile_"+mode, "program_id": programId})
		output = r.json()
		id = output["run_id"]
		print "current parallel run's dataset id:", id

		procs = []
		for i in range(threadCount):
			optionStr = "parallel:true"
			if (mode == "hashBased"):
				# a more complicated param in this case
				optionStr = "hashBasedParallel: {on: true, numThreads: " + str(threadCount) + ", thisThreadIndex: " + str(i) + "}"
				# print optionStr
			p = RunProgramProcess(str(i), programId, '{' + optionStr + ', dataset_id: '+ str(id) +'}')
			procs.append(p)

		for p in procs:
			time.sleep(2) # don't overload; also, wait for thing to load
			p.start()
		
		# below will be true if all complete within the time limit, else false
		noErrorsRunComplete = joinProcesses(procs, timeoutInSeconds)

	print "------"

	f = open("parallelDatasetUrls.txt", "a")
	allDatasetsAllIterations.append(id)
	f.write("http://kaofang.cs.berkeley.edu:8080/datasets/rundetailed/" + str(id) + "\n")
	# f.write("kaofang.cs.berkeley.edu:8080/downloaddetailedmultipass/" + str(newDatasetId) + "\n")
	f.close()

	for datasetId in allDatasetsAllIterations:
		# this is just to give the user some feedback
		print "http://kaofang.cs.berkeley.edu:8080/datasets/rundetailed/" + str(datasetId)

	print "------"

def parallelizationTest(programIdsLs, threadCounts, timeoutInSeconds, mode):
	allDatasetsAllIterations = []
        for programId in programIdsLs:
                for threadCount in threadCounts:
			oneRun(programId,allDatasetsAllIterations, threadCount, timeoutInSeconds, mode)

def main():
        mode = "hashBased"
        fullBenchmarkProgIds = [
                              128, #community foundations
                              479, #yelp restaurants
                              467, #twitter tweets
                              483, #yelp reviews
                              507, #craigslist listings
                              509, #yelp menu items
                              152 #zimride
                              ]

        fullThreadCounts = [1,2,4,6,8]
        fullBenchmarkProgIds = [550] #550 was with inner skip block turned off for reviews
        if (mode == "lockBased"):
                parallelizationTest(fullBenchmarkProgIds, fullThreadCounts, 86400, mode)
        elif (mode == "hashBased"):
                parallelizationTest(fullBenchmarkProgIds, fullThreadCounts, 86400, mode)
        if (mode == "caseStudy"):
                parallelizationTest([519], [8], 864000, "lockBased")
                

main()
