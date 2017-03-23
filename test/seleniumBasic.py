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

def main():
	runEntityScopeAndNoEntityScopeVersionsInParallel(45)


main()
a = raw_input("Type 'done' to close Chrome window...")
if (a == 'done'):
	for driver in drivers:
		driver.close()
