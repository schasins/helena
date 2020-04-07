export namespace HelenaConfig {
  export let helenaServerUrl =
    "http://helena-backend.us-west-2.elasticbeanstalk.com";
  export const nextButtonAttemptsThreshold = 4;
  export let numRowsToSendInOneSlice = 10;
  export const relationFindingTimeoutThreshold = 15000;
  export const relationScrapeWait = 1000;
}