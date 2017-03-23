from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
import time

unpackedExtensionPath = "../src"
#chromeDriverPath = '/Users/schasins/Downloads/chromedriver'
chromeDriverPath = '/home/schasins/Downloads/chromedriver'

#come up with a better way to manage this
#extensionkey = "bcnlebcnondcgcmmkcnmepgnamoekjnn"
extensionkey = "clelgfmpjhkenbpdddjihmokjgooedpl"

drivers = []
def newDriver():

	chrome_options = Options()
	chrome_options.add_argument("--load-extension=" + unpackedExtensionPath)
	driver = webdriver.Chrome(chromeDriverPath, chrome_options=chrome_options)

	driver.get("chrome-extension://" + extensionkey + "/pages/mainpanel.html")

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
        # print ans
	if (not ans):
		time.sleep(1)
		return blockingRepeatUntilNonFalseAnswer(lam)
	else:
		return ans

def getDatasetIdForDriver(driver):
	getDatasetId = lambda : driver.execute_script("console.log('datasetsScraped', datasetsScraped); if (datasetsScraped.length > 0) {console.log('realAnswer', datasetsScraped[0]); return datasetsScraped[0];} else { return false;}")
	return blockingRepeatUntilNonFalseAnswer(getDatasetId)

def getWhetherDone(driver):
	getHowManyDone = lambda: driver.execute_script("console.log('scrapingRunsCompleted', scrapingRunsCompleted); if (scrapingRunsCompleted === 0) {return false;} else {return scrapingRunsCompleted}")
	return blockingRepeatUntilNonFalseAnswer(getHowManyDone)

def entityScopeVsNoEntityScopeFirstRunExperiment(programIdsLs):
	global drivers

	allDatasets = []

	for programId in programIdsLs:
		runEntityScopeAndNoEntityScopeVersionsInParallel(programId)
		datasetIds = []
		for driver in drivers:
			datasetIds.append(getDatasetIdForDriver(driver))
		print datasetIds
		allDatasets += datasetIds
		for driver in drivers:
			getWhetherDone(driver)
			# note that we'll only get out of this loop once all drivers have finished the scripts they're executing
		for driver in drivers:
			driver.close()
		drivers = []

	print allDatasets
	for datasetId in allDatasets:
		print "kaofang.cs.berkeley.edu:8080/downloaddetailed/" + str(datasetId)

def main():
	entityScopeVsNoEntityScopeFirstRunExperiment([60,60])

main()
