from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

import sys
import uuid
import time


MAX_ITERATIONS = 10
TIMEOUT_SEC = 30
COMPILE_TIMEOUT_SEC = 3600
RUN_TIMEOUT_SEC = 300

serverUrl = sys.argv[1]
extensionKey = sys.argv[2]
programId = int(sys.argv[3])


def newDriver():
    chrome_options = Options()
    chrome_options.add_extension('/src.crx')

    desired = DesiredCapabilities.CHROME
    desired['loggingPrefs'] = {'browser': 'ALL'}

    driver = webdriver.Chrome(
        chrome_options=chrome_options, desired_capabilities=desired)
    driver.get("chrome-extension://%s/pages/mainpanel.html" % extensionKey)
    return driver


def recordNewProgram(programId, iteration=0):
    driver = None
    try:
        if iteration > MAX_ITERATIONS:
            print >> sys.stderr, "Maximum iterations %d exceeded" % MAX_ITERATIONS
            return False
        # open extension window
        driver = newDriver()
        # wait for recording window to be opened
        # driver.implicitly_wait(60)
        wait = WebDriverWait(driver, TIMEOUT_SEC)
        wait.until(EC.number_of_windows_to_be(2))
        # identify control and recording windows
        control_window = None
        recording_window = None
        all_windows = driver.window_handles
        for w in all_windows:
            driver.switch_to.window(w)
            relative_url = driver.execute_script("return window.top.location.pathname")
            if relative_url == "/pages/newRecordingWindow.html":
                recording_window = w
            elif relative_url == "/pages/mainpanel.html":
                control_window = w
            else:
                assert False
        driver.switch_to_window(control_window)
        print "control window: ", driver.title
        driver.switch_to_window(recording_window)
        print "recording window: ", driver.title
        # open new tab and navigate to test page
        driver.execute_script("window.open('https://scholar.google.com/scholar?hl=en&as_sdt=0%2C48&q=geoffrey+hinton+deep+learning')")
        wait.until(EC.new_window_is_opened(all_windows))
        new_window = driver.window_handles[-1]
        driver.switch_to_window(new_window)
        wait.until(EC.title_contains('Google Scholar'))
        print "new window: ", driver.title
        # get first canonical link
        canonical_link = wait.until(EC.presence_of_element_located((By.XPATH, '//h3[@class="gs_rt"]/a')))
        print "canonical_link: ", canonical_link.get_attribute('innerHTML')
        # get first doc link
        doc_link = wait.until(EC.presence_of_element_located((By.XPATH, '//*[@id="gs_res_ccl_mid"]/div/div[1]/div/div/a')))
        print "doc_link: ", doc_link.get_attribute('innerHTML')
        # get authors
        authors = wait.until(EC.presence_of_element_located((By.XPATH, '//div[@class="gs_a"]')))
        print "authors: ", authors.get_attribute('innerHTML')
        # get description
        description = wait.until(EC.presence_of_element_located((By.XPATH, '//div[@class="gs_rs"]')))
        print "description: ", description.get_attribute('innerHTML').encode('utf-8')
        # get citation link
        citations_link = wait.until(EC.presence_of_element_located((By.XPATH, '//a[contains(text(),"Cited by")]')))
        print "citations_link: ", citations_link.get_attribute('innerHTML')
        # get related articles link
        related_articles_link = wait.until(EC.presence_of_element_located((By.XPATH, '//a[contains(text(),"Related articles")]')))
        print "related_articles_link: ", related_articles_link.get_attribute('innerHTML')
        # select all these page elements for the new script
        text_elements = [authors, description]
        link_elements = [canonical_link, doc_link, citations_link, related_articles_link]
        for elem in text_elements:
            click(driver, elem)
            time.sleep(1)
        for elem in link_elements:
            click(driver, elem, is_link=True)
            time.sleep(1)
        # stop recording
        driver.switch_to_window(control_window)
        stop_recording_button = driver.find_element_by_id("stop_recording")
        stop_recording_button.click()
        # wait for script compilation to finish
        print "Waiting for script compilation to finish..."
        WebDriverWait(driver, COMPILE_TIMEOUT_SEC).until(EC.invisibility_of_element_located((By.ID, "overlay_text")))
        time.sleep(5)
        # name new script
        print "Naming script..."
        new_program_name = str(uuid.uuid4())
        program_name_textbox = wait.until(EC.element_to_be_clickable((By.ID, "program_name")))
        program_name_textbox.clear()
        program_name_textbox.send_keys(new_program_name)
        time.sleep(5)
        # run script
        print "Running script..."
        # run_script_button = wait.until(EC.element_to_be_clickable((By.ID, "run")))
        run_script_button = wait.until(EC.element_to_be_clickable((By.XPATH, '//button[@id="run"]/span')))
        run_script_button.click()
        time.sleep(5)
        # wait for script to finish
        print "Waiting for script to finish..."
        # WebDriverWait(driver, RUN_TIMEOUT_SEC).until(EC.visibility_of_element_located((By.CLASS_NAME, "done_note")))
        WebDriverWait(driver, RUN_TIMEOUT_SEC).until(EC.visibility_of_element_located((By.XPATH, '//*[@id="running_script_content"]/div[3]/div[2]')))
        print "All done!"
    except TimeoutException as e:
        driver.quit()
        print >> sys.stderr, "Timeout on iteration %d, retrying..." % iteration
        recordNewProgram(programId, iteration + 1)
    finally:
        if driver is not None:
            driver.quit()
        sys.stderr.flush()
    return True


def click(driver, elem, is_link=False):
    modifiers = [Keys.ALT]
    if is_link:
        modifiers.append(Keys.SHIFT)
    action = ActionChains(driver)
    for mod in modifiers:
        action.key_down(mod)
    action.click(elem)
    for mod in modifiers:
        action.key_up(mod)
    action.perform()


def main():
    return 0 if recordNewProgram(programId) else 1


sys.exit(main())
