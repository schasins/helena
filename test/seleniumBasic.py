from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time

unpackedExtensionPath = "../src"
chromeDriverPath = '/Users/schasins/Downloads/chromedriver'

drivers = []
def newDriver():

	chrome_options = Options()
	chrome_options.add_argument("--load-extension=" + unpackedExtensionPath)
	driver = webdriver.Chrome(chromeDriverPath, chrome_options=chrome_options)

	driver.get("chrome-extension://bcnlebcnondcgcmmkcnmepgnamoekjnn/pages/mainpanel.html")

	drivers.append(driver)
	return driver

def runScrapingProgram(progId, optionsStr):

	driver = newDriver()

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

def runEntityScopeAndNoEntityScopeVersionsInParallel(programId):
	runScrapingProgram(programId, "")
	runScrapingProgram(programId, "{ignoreEntityScope: true}")	

def blockingRepeatUntilNonFalseAnswer(lam):
	ans = lam()
	print ans
	if (not ans):
		time.sleep(1)
		return blockingRepeatUntilNonFalseAnswer(lam)
	else:
		return ans

def getDatasetIdForDriver(driver):
	getDatasetId = lambda : driver.execute_script("if (datasetsBeingScrapedNow.length > 0) {return datasetsBeingScrapedNow[0];} else { return false;}")
	return blockingRepeatUntilNonFalseAnswer(getDatasetId)

def getWhetherDone(driver):
	getHowManyDone = lambda: driver.execute_script("if (scrapingRunsCompleted === 0) {return false;} else {return scrapingRunsCompleted}")
	return blockingRepeatUntilNonFalseAnswer(getHowManyDone)

def entityScopeVsNoEntityScopeFirstRunExperiment(programIdsLs):
	global drivers
	for programId in programIdsLs:
		runEntityScopeAndNoEntityScopeVersionsInParallel(programId)
		datasetIds = []
		for driver in drivers:
			datasetIds.append(getDatasetIdForDriver(driver))
		print datasetIds
		for driver in drivers:
			getWhetherDone(driver)
			# note that we'll only get out of this loop once all drivers have finished the scripts they're executing
		for driver in drivers:
			driver.close()
		drivers = []

def main():
	entityScopeVsNoEntityScopeFirstRunExperiment([60,45])

main()
