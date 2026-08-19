"use strict";
/**
 * Adapter registry.
 *
 * Names here must match the `adapter` field in config/development-sources.json.
 * The source registry resolves them by name, so adding a source is a config
 * change plus one file, never an edit to the core.
 */

const { AssetSourceAdapter, normalizeSpdx } = require("./base");
const { OpenverseAdapter } = require("./openverse");
const { InternetArchiveAdapter } = require("./internet-archive");
const { WikimediaAdapter } = require("./wikimedia");
const { GitHubAdapter } = require("./github");
const { FreesoundAdapter } = require("./freesound");
const { PixabayAdapter } = require("./pixabay");
const { SyntheticAdapter, DirectUrlAdapter, ManualSourceAdapter } = require("./local");

module.exports = {
  AssetSourceAdapter,
  normalizeSpdx,

  OpenverseAdapter,
  InternetArchiveAdapter,
  WikimediaAdapter,
  GitHubAdapter,
  FreesoundAdapter,
  PixabayAdapter,
  SyntheticAdapter,
  DirectUrlAdapter,
  ManualSourceAdapter,
};
