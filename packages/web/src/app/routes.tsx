import { createBrowserRouter } from 'react-router'
import { RootRedirect } from '../shell/RootRedirect'
import { ShellLayout } from '../shell/ShellLayout'
import { BrowsePage } from '../browse/BrowsePage'

/**
 * Pages (web-shell.md「页面清单」). Every page belongs to a library: `/libraries/<lib>/…`.
 * ShellLayout (line web-1) is the persistent frame — sidebar, inspector, overlays — and renders pages in its outlet.
 * Browse keeps its query in the URL search params; detail keeps `?tab=`; compare keeps `?a=&b=&av=&bv=&mode=`.
 */
export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  {
    path: '/libraries/:lib',
    element: <ShellLayout />,
    children: [
      { index: true, element: <BrowsePage /> },
      // every other page is its own chunk, loaded when first visited
      { path: 'asset/:id', lazy: () => import('../detail/DetailPage').then(m => ({ Component: m.DetailPage })) },
      { path: 'compare', lazy: () => import('../compare/ComparePage').then(m => ({ Component: m.ComparePage })) },
      { path: 'review', lazy: () => import('../review/ReviewQueuePage').then(m => ({ Component: m.ReviewQueuePage })) },
      { path: 'issues', lazy: () => import('../pages/IssuesPage').then(m => ({ Component: m.IssuesPage })) },
      { path: 'trash', lazy: () => import('../pages/TrashPage').then(m => ({ Component: m.TrashPage })) },
      { path: 'tags', lazy: () => import('../pages/TagsPage').then(m => ({ Component: m.TagsPage })) },
      { path: 'settings', lazy: () => import('../pages/SettingsPage').then(m => ({ Component: m.SettingsPage })) },
      { path: 'settings/:section', lazy: () => import('../pages/SettingsPage').then(m => ({ Component: m.SettingsPage })) },
      { path: 'plugins/:plugin/:page', lazy: () => import('../shell/PluginPage').then(m => ({ Component: m.PluginPage })) }
    ]
  }
])
