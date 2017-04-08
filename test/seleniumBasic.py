from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time
from sys import platform
from multiprocessing import Process, Queue
import traceback
import logging

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
	chrome_options.add_argument("user-data-dir=profiles/" + profile)

	driver = webdriver.Chrome(chromeDriverPath, chrome_options=chrome_options)

	driver.get("chrome-extension://" + extensionkey + "/pages/mainpanel.html")
	return driver

def runScrapingProgram(profile, progId, optionsStr):

	driver = newDriver(profile)

	driver.execute_script("RecorderUI.loadSavedProgram(" + str(progId) + ");")

	runCurrentProgramJS = """
	function repeatUntilReadyToRun(){
		console.log("repeatUntilReadyToRun");
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
	return driver

def blockingRepeatUntilNonFalseAnswer(lam):
	ans = lam()
	while (not ans):
		time.sleep(1)
		ans = lam()
	return ans

def getDatasetIdForDriver(driver):
	getDatasetId = lambda : driver.execute_script("console.log('datasetsScraped', datasetsScraped); if (datasetsScraped.length > 0) {console.log('realAnswer', datasetsScraped[0]); return datasetsScraped[0];} else { return false;}")
	return blockingRepeatUntilNonFalseAnswer(getDatasetId)

def getWhetherDone(driver):
	getHowManyDone = lambda: driver.execute_script("console.log('scrapingRunsCompleted', scrapingRunsCompleted); if (scrapingRunsCompleted === 0) {return false;} else {return scrapingRunsCompleted}")
	return blockingRepeatUntilNonFalseAnswer(getHowManyDone)


def runProgramThread(allDatasets, profile, programId, optionStr, numTriesSoFar=0):
        try:
                driver = runScrapingProgram(profile, programId, optionStr)
                datasetId = getDatasetIdForDriver(driver)
                print programId, datasetId
                allDatasets.put(datasetId)
                done = getWhetherDone(driver)
                print programId, done
                driver.close()
                driver.quit()
                return datasetId
        except Exception as e:
                # assume we can just recover by trying again
                if (numTriesSoFar < 3):
                        runProgramThread(allDatasets, profile, programId, optionStr, numTriesSoFar + 1)
                else:
                        logging.error(traceback.format_exc())
                        return None

def entityScopeVsNoEntityScopeFirstRunExperiment(programIdsLs):
	for programId in programIdsLs:
                allDatasets = Queue()
		p1 = Process(target=runProgramThread, args=(allDatasets,"1",programId,'{}'))
		p2 = Process(target=runProgramThread, args=(allDatasets,"2",programId,'{ignoreEntityScope: true}'))
		d1 = p1.start()
		d2 = p2.start()
		p1.join()
		p2.join()
		print "------"

	print allDatasets
	for datasetId in allDatasets:
		print "kaofang.cs.berkeley.edu:8080/downloaddetailed/" + str(datasetId)

def recoveryExperiment(programIdsLs, simulatedErrorLocs):
        allDatasetsAllIterations = []
	for j in range(3): # do three runs
		for programId in programIdsLs:
			for i in range(len(simulatedErrorLocs[programId])):
                                allDatasets = Queue()
				errorLoc = simulatedErrorLocs[programId][i]
				simulateErrorIndexesStr = str(errorLoc)

				p1 = Process(target=runProgramThread, args=(allDatasets,"1",programId,'{nameAddition: "+naive+loc'+str(i)+'+run'+str(j)+'", ignoreEntityScope: true, simulateError:'+ simulateErrorIndexesStr + '}')) # naive recovery strategy
				p2 = Process(target=runProgramThread, args=(allDatasets,"2",programId,'{nameAddition: "+escope+loc'+str(i)+'+run'+str(j)+'", simulateError:'+ simulateErrorIndexesStr + '}')) # our recovery strategy
				p3 = Process(target=runProgramThread, args=(allDatasets,"3",programId,'{nameAddition: "+ideal+loc'+str(i)+'+run'+str(j)+'"}')) # the perfect ideal recovery strategy, won't encounter simulated error
				p4 = Process(target=runProgramThread, args=(allDatasets,"4",programId,'{nameAddition: "+ideal+loc'+str(i)+'+run'+str(j)+'", ignoreEntityScope: true}')) # an alternative perfect ideal recovery strategy, won't encounter simulated error, but also won't use entityScope
				d1 = p1.start()
				d2 = p2.start()
				d3 = p3.start()
                                d4 = p4.start()
				p1.join()
				p2.join()
				p3.join()
                                p4.join()

				print "------"

                                for i in range(4):
                                        newDatasetId = allDatasets.get()
                                        allDatasetsAllIterations.append(newDatasetId)

                                for datasetId in allDatasetsAllIterations:
                                        print "kaofang.cs.berkeley.edu:8080/downloaddetailed/" + str(datasetId)

                                print "------"

def main():
	programIds = [128,\ # community foundations
                      129,\ # twitter
        ]
	simulatedErrorLocs = {
		128: [[27], [54], [81]],
                129: [[1,608], [2,409], [3,192]]
	}
	recoveryExperiment(programIds, simulatedErrorLocs)

main()
