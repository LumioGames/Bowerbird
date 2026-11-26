/**
 * community.forge — web part. Fills every UI slot a plugin can fill (prototype plugin-demo.js): a detail tab「Forge」
 * on what it made, a top-bar button with this month's quota, a side-bar section with the runs, a settings page, and
 * the page `pick` that a finished run asks the user to open (ADR-042).
 */
import { defineWebPlugin } from '@bowerbird/plugin-sdk/web'
import { NAME } from './api'
import { ForgeTab, PickPage, QuotaLabel, QuotaPopover, RunsSection, SettingsPage, isForgeAsset } from './views'

export default defineWebPlugin({
  ui: {
    detailTabs: [{ id: 'forge', title: NAME, appliesTo: isForgeAsset, Component: ForgeTab }],
    toolbarItems: [{ id: 'forge-quota', title: NAME, icon: 'wand-sparkles', Label: QuotaLabel, Popover: QuotaPopover }],
    sidebarSections: [{ id: 'forge-runs', title: NAME, Component: RunsSection }],
    pages: [{ id: 'pick', title: '挑选', Component: PickPage }],
    settingsPages: [{ id: 'forge', title: NAME, Component: SettingsPage }]
  }
})
