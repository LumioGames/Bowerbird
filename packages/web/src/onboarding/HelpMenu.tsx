import { useNavigate } from 'react-router'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@bowerbird/plugin-sdk/web'
import { Icon } from '../components/Icon'
import { t } from '../lib/i18n'
import { MenuEntries } from '../overlays/menu'
import { libPath } from '../shell/runtime'
import { replayOnboarding, setHintsOff, useOnboarding } from './store'

/**
 * The side bar's「帮助」(?) button (onboarding.md「左下角「?」」): 重新看导览 forgets what was seen and starts the tour on
 * this library's browse page; 关掉提示 / 打开提示 turns every hint off or back on.
 */
export function HelpMenu({ lib }: { lib: string }) {
  const navigate = useNavigate()
  const { off } = useOnboarding()
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('ob.help')} title={t('ob.help')} data-onboard="side.help"><Icon name="circle-help" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <MenuEntries kind="dropdown" close={() => {}} entries={[
          { id: 'replay', icon: 'rotate-ccw', label: t('ob.replay'), onSelect: () => { replayOnboarding(); navigate(libPath(lib)) } },
          { id: 'toggle', icon: off ? 'eye' : 'eye-off', label: t(off ? 'ob.hintsOn' : 'ob.hintsOff'), onSelect: () => setHintsOff(!off) }
        ]} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
