from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
import sys
import uuid


serverUrl = sys.argv[1]
extensionKey = sys.argv[2]
programId = int(sys.argv[3])


def newDriver():
    chrome_options = Options()
    chrome_options.add_extension('/helena.crx')

    desired = DesiredCapabilities.CHROME
    desired['loggingPrefs'] = {'browser': 'ALL'}

    driver = webdriver.Chrome(
        chrome_options=chrome_options, desired_capabilities=desired)
    driver.get("chrome-extension://%s/pages/mainpanel.html" % extensionKey)
    return driver


def loadAndSaveProgram(programId):
    try:
        driver = newDriver()
        # load the program
        driver.execute_script(
                'window.helenaMainpanel.UIObject.setGlobalConfig({"helenaServerUrl":"%s"});' % (
                    serverUrl))
        driver.execute_script("window.helenaMainpanel.UIObject.loadSavedProgram(" + str(programId) + ");")
        # change name
        new_program_name = str(uuid.uuid4())
        wait = WebDriverWait(driver, 10)
        program_name_textbox = wait.until(ec.element_to_be_clickable((By.ID, "program_name")))
        old_program_name = program_name_textbox.get_attribute("value")
        program_name_textbox.clear()
        program_name_textbox.send_keys(new_program_name)
        # save program
        save_program_button = driver.find_element_by_id("save")
        save_program_button.click()
        program_save_status = driver.find_element_by_id("program_save_status")
        # if we don't wait for this, the cloned program will be saved with no script content
        wait.until(ec.text_to_be_present_in_element((By.ID, "program_save_status"), "Saved"))
        # verify cloned program is saved under new name
        saved_scripts_tab = driver.find_element_by_id("saved_scripts")
        saved_scripts_tab.click()
        saved_script_list = wait.until(ec.visibility_of_element_located((By.ID, "saved_script_list")))
        for cell in saved_script_list.find_elements_by_xpath(".//td"):
            value = cell.text
            if value == new_program_name:
                break
        else:
            assert False, "new program name not found"
    except Exception as e:
        print >> sys.stderr, e
        return False
    finally:
        sys.stderr.flush()
    return True


def main():
    return 0 if loadAndSaveProgram(programId) else 1


sys.exit(main())
