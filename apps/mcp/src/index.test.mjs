import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedTools = [
  "analytics_report", "assign_posts_to_campaign", "bulk_reschedule_posts", "create_asset_folder", "create_brand",
  "create_campaign", "create_post", "create_posts", "create_slideshow_batch", "create_slideshows", "create_template",
  "create_video_batch", "delete_analytics_report", "delete_asset_folder", "delete_brand", "delete_campaign", "delete_media",
  "delete_post", "delete_posts", "delete_slideshow", "delete_template", "delete_video", "get_media_source_status", "get_provider_status",
  "get_publishing_settings", "health_check", "import_stock_media", "list_analytics_reports", "list_asset_folders",
  "list_brands", "list_campaigns", "list_destinations", "list_media", "list_notifications", "list_posts", "list_slideshows",
  "list_templates", "list_videos", "mark_notifications_read", "move_media", "publish_post_now", "rename_asset_folder",
  "rename_media", "render_slideshow", "render_video", "reschedule_post", "retry_failed_targets", "save_slideshow",
  "save_video", "schedule_analytics_report", "schedule_slideshow", "schedule_video", "search_stock_media", "update_brand",
  "update_campaign", "update_post", "update_publishing_settings", "upload_media",
].sort();

test("registers the complete agent-safe Relay MCP surface exactly once", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  const names = [...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(names).size, names.length, "MCP tool names must be unique");
  assert.deepEqual(names.sort(), expectedTools);
});
