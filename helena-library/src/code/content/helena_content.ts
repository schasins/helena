import { ScrapeModeFilters } from "./filters/scrape_mode_filters";
import { RecordingModeHandlers } from "./handlers/recording_mode_handlers";
import { ScrapeModeHandlers } from "./handlers/scrape_mode_handlers";
import { TabDetailsMessage, WindowsMessage, WindowIdMessage, Messages,
  FastModeMessage, ColumnIndexMessage, LikelyRelationMessage,
  FreshRelationItemsMessage,
  RelationMessage} from "../common/messages";
import { RecordingModeFilters } from "./filters/recording_mode_filters";
import { RelationHighlighter } from "./ui/relation_highlighter";
import { Screenshot } from "./utils/screenshot";
import { MiscUtilities } from "../common/misc_utilities";
import { RecordState } from "../ringer-record-replay/common/messages";
import { ContentSelector, RelationSelector } from "./selector/relation_selector";
import { RelationFinder } from "./selector/relation_finding";
import { NextButtonSelector } from "./selector/next_button_selector";
import { HelenaConsole } from "../common/utils/helena_console";

/**
 * Stores Helena's global state variables for the content scripts.
 */
export class HelenaContent {
  /** 
   * Whether scraping is enabled/disabled.
   */
  public scrapeMode: boolean;

  /**
   * Information about the Tab in which the content script is running.
   */
  public tabId?: number;
  public windowId?: number;
  public tabTopUrl?: string;

  /**
   * Keep track of the last Element the user was hovering over so that it can be
   *   highlighted when the user enters scrape mode.
   */
  public mostRecentMousemoveTarget?: EventTarget | null;

  /**
   * Keep track of keys currently being pressed down as a map from keyCode to
   *   boolean (true means pressed).
   */
  public currentlyPressedKeys?: { [key: number]: boolean };

  /**
   * Highlighted element when in scrape mode.
   */
  public highlightedElement?: JQuery<HTMLElement>;

  /**
   * Record and replay state.
   */
  public currentRecordingWindows?: number[];
  public currentReplayWindowId?: number;

  public currentSelectorToEdit: ContentSelector | null;
  public relationHighlighter: RelationHighlighter;


  /**
   * Fast mode: good for speed, bad for evolving webpages.
   */
  ringerUseXpathFastMode = false;

  public currentlyRecording() {
    // `recording` is defined in scripts/lib/record-replay/content_script.js,
    //   tells whether r+r layer currently recording
    return window.ringerContent.recording === RecordState.RECORDING
      && this.windowId && this.currentRecordingWindows
      && this.currentRecordingWindows.indexOf(this.windowId) > -1;
  }

  /**
   * Returns true if currently scraping (e.g. Alt key held down).
   */
  public currentlyScraping() {
    return this.scrapeMode;
  }

  /**
   * Activates Helena's scrape mode.
   */
  public activateScrapeMode() {
    this.scrapeMode = true;

    window.ringerContent.additional_recording_handlers_on.scrape = true;
    window.ringerContent.additional_recording_filters_on.ignoreExtraCtrlAlt =
      true;
  }

  /**
   * Disables Helena's scrape mode.
   */
  public disableScrapeMode() {
    this.scrapeMode = false;

    window.ringerContent.additional_recording_handlers_on.scrape = false;
    window.ringerContent.additional_recording_filters_on.ignoreExtraCtrlAlt =
      false;
  }

  /**
   * Highlights relevant relation to element.
   * @param element element
   */
  public highlightRelevantRelation(element: HTMLElement) {
    this.relationHighlighter.highlightRelevantRelation(element);
  }

  /**
   * Unhighlights highlighted relation.
   */
  public unhighlightRelation() {
    this.relationHighlighter.unhighlight();
  }

  constructor() {
    this.scrapeMode = false;
    this.currentlyPressedKeys = {};
    this.relationHighlighter = new RelationHighlighter();

    this.pollForState();

    this.initializeStartRecordingHooks();

    this.initializeRecordingModeFilters();
    this.initializeScrapeModeFilters();

    this.initializeRecordingModeHandlers();
    this.initializeScrapeModeHandlers();

    this.listenForMainpanelMessages();
  }

  /**
   * Polls mainpanel and background for state, presumably because you can't
   *   directly access this information in content scripts.
   */
  private pollForState() {
    const self = this;

    /*
     * 1. Set up initial listeners.
     */
    Messages.listenForMessage("background", "content", "tabID",
    function (msg: TabDetailsMessage) {
        self.tabId = msg.tab_id;
        self.windowId = msg.window_id;
        self.tabTopUrl = msg.top_frame_url;
        console.log("tabId info", self.tabId, self.windowId,
            self.tabTopUrl);
      }
    );
    Messages.listenForMessage("mainpanel", "content",
      "currentRecordingWindows", function (msg: WindowsMessage) {
        self.currentRecordingWindows = msg.window_ids;
    });

    Messages.listenForMessage("mainpanel", "content",
      "currentReplayWindowId", function (msg: WindowIdMessage) {
        self.currentReplayWindowId = msg.window; 
        RecordingModeHandlers.applyReplayOverlayIfAppropriate(msg.window);
    });

    Messages.listenForMessage("mainpanel", "content", "ringerUseXpathFastMode", 
      (msg: FastModeMessage) => { self.ringerUseXpathFastMode = msg.use; });

    /*
     * 2. Poll mainpanel and background.
     * TODO: cjbaik: switch this pattern to a port connection rather than
     *   doing this polling
     * TODO: cjbaik: also, the ordering of these matters; requestTabID has to
     *   happen first...
     */
    MiscUtilities.repeatUntil(
      function() {
          Messages.sendMessage("content", "background",
              "requestTabID", {});
      },
      function() {
          return (self.tabId && self.windowId);
      },
      function() {},
      1000, true);

    MiscUtilities.repeatUntil(
      function () {
          Messages.sendMessage("content", "mainpanel",
              "requestCurrentRecordingWindows", {});
      },
      function () {
          return !!self.currentRecordingWindows;
      },
      function () {},
      1000, true);

    MiscUtilities.repeatUntil(
      function () {
          Messages.sendMessage("content", "mainpanel",
              "currentReplayWindowId", {});
      },
      function () {
          return !!self.currentReplayWindowId;
      },
      function () {},
      1000, true);
    
    Messages.sendMessage("content", "mainpanel",
      "requestRingerUseXpathFastMode", {});
  }
  
  /**
   * Initialize hooks for when recording starts.
   */
  private initializeStartRecordingHooks() {
    window.ringerContent.addonStartRecording.push(
      // Without the `bind` call, `getKnownRelations` seems to reference the
      //   wrong `this` object.
      this.relationHighlighter.getKnownRelations.bind(
        this.relationHighlighter));
  }

  /**
   * Initializes recording mode handlers.
   */
  private initializeRecordingModeHandlers() {
    window.ringerContent.additional_recording_handlers_on.visualization = true;
    window.ringerContent.additional_recording_handlers.visualization =
      Screenshot.take;

    document.addEventListener('contextmenu',
      RecordingModeHandlers.preventOpeningContextMenu, true);
    document.addEventListener('mouseover',
      RecordingModeHandlers.mouseoverHandler, true);
    document.addEventListener('mouseout',
      RecordingModeHandlers.mouseoutHandler, true);
    document.addEventListener('keydown',
      RecordingModeHandlers.updateScraping, true);
    document.addEventListener('keyup',
      RecordingModeHandlers.updateScraping, true);
  }

  /**
   * Initializes recording mode filters (i.e. things not to record).
   */
  private initializeRecordingModeFilters() {
    window.ringerContent.additional_recording_filters_on.ignoreExtraKeydowns =
      true;
    window.ringerContent.additional_recording_filters.ignoreExtraKeydowns = 
      RecordingModeFilters.ignoreExtraKeydowns;
  }

  /**
   * Initializes scrape mode filters (i.e. things not to record).
   */
  private initializeScrapeModeFilters() {
    window.ringerContent.additional_recording_filters.ignoreExtraCtrlAlt =
      ScrapeModeFilters.ignoreExtraCtrlAlt;
  }

  /**
   * Initializes scrape mode (e.g. when Alt button pressed) handlers.
   */
  private initializeScrapeModeHandlers() {
    window.ringerContent.additional_recording_handlers.scrape =
      ScrapeModeHandlers.sendScrapedDataToMainpanel;
  
    document.addEventListener('mousemove',
      ScrapeModeHandlers.updateMousemoveTarget, true);
    document.addEventListener('click',
      ScrapeModeHandlers.preventClickPropagation, true);
  }

  private listenForMainpanelMessages() {
    Messages.listenForMessage("mainpanel", "content", "getRelationItems",
      (msg: RelationMessage) => {
        const selector = RelationSelector.fromMessage(msg);
        RelationFinder.sendMatchingRelationToMainpanel(selector);
      }
    );

    Messages.listenForMessage("mainpanel", "content", "getFreshRelationItems",
      (msg: RelationMessage) => {
        const selector = RelationSelector.fromMessage(msg);
        RelationFinder.getFreshRelationItems(selector);
      }
    );

    Messages.listenForMessage("mainpanel", "content", "editRelation",
      (msg: RelationMessage) => {
        const selector = RelationSelector.fromMessage(msg);
        RelationFinder.editRelation(selector);
      }
    );

    Messages.listenForMessage("mainpanel", "content", "nextButtonSelector",
      () => {
        NextButtonSelector.listenForNextButtonClick();
      }
    );

    Messages.listenForMessage("mainpanel", "content", "clearNextButtonSelector",
      () => {
        NextButtonSelector.unhighlightNextButton();
      }
    );

    Messages.listenForMessage("mainpanel", "content", "backButton", () => {
      history.back();
    });

    Messages.listenForMessage("mainpanel", "content", "pageStats", () => {
      Messages.sendMessage("content", "mainpanel", "pageStats", {
        numNodes: document.querySelectorAll('*').length
      });
    });

    Messages.listenForMessage("mainpanel", "content", "runNextInteraction",
      (msg: RelationMessage) => {
        // let selector = RelationSelector.fromMessage(msg);
        RelationFinder.getNextPage(msg);
      }
    );

    Messages.listenForMessage("mainpanel", "content", "currentColumnIndex",
      (msg: ColumnIndexMessage) => {
        RelationFinder.setEditRelationIndex(msg.index);
      }
    );

    Messages.listenForMessage("mainpanel", "content", "clearRelationInfo",
      (msg: RelationMessage) => {
        // let selector = RelationSelector.fromMessage(msg);
        RelationFinder.clearRelationInfo(msg);
      }
    );

    Messages.listenForFrameSpecificMessage("mainpanel", "content",
      "likelyRelation", (msg: object, sendResponse: Function) => {
        MiscUtilities.registerCurrentResponseRequested(msg,
          (m: LikelyRelationMessage) => {
            let likelyRel = RelationFinder.likelyRelation(m);
            console.log('likelyRel', likelyRel);
            if (likelyRel) {
              sendResponse(likelyRel);
            }
          }
        );
      }
    );

    Messages.listenForFrameSpecificMessage("mainpanel", "content",
    "getFreshRelationItems", (msg: object, sendResponse: Function) => {
      MiscUtilities.registerCurrentResponseRequested(msg, 
        (msg: RelationMessage) => {
          const selector = RelationSelector.fromMessage(msg);
          RelationFinder.getFreshRelationItemsHelper(selector,
            (freshRelationItems: FreshRelationItemsMessage) => {
              HelenaConsole.namedLog("getRelationItems",
                'freshRelationItems, about to send', freshRelationItems.type,
                freshRelationItems);
              sendResponse(freshRelationItems);
            }
          );
        });
      }
    );
  }
}