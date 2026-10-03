import { useState } from 'react';
import { useApp } from '../context.js';
import Contacts from './Contacts.jsx';
import Minutes from './Minutes.jsx';
import { Tabs } from './ui.jsx';
import cardsIcon from '../assets/tab-business-cards.png';
import minutesIcon from '../assets/tab-meeting-minutes.png';

// Tab icons: an image (img), or a built-in icon name (icon).
const TAB_ICONS = {
  cards: { img: cardsIcon },
  minutes: { img: minutesIcon },
};

const TAB_KEY = 'nomiqo.homeTab';
const readTab = () => { try { return sessionStorage.getItem(TAB_KEY) || 'cards'; } catch { return 'cards'; } };

/** The home screen: business cards and meeting minutes, one tab each. Opens on cards after sign-in. */
export default function Home() {
  const { can } = useApp();
  const [stored, setTabRaw] = useState(readTab);
  const showMinutes = can('minutes_tab');
  const tab = showMinutes ? stored : 'cards';
  if (!showMinutes) return <div className="home"><Contacts /></div>;
  const setTab = (v) => {
    setTabRaw(v);
    try { sessionStorage.setItem(TAB_KEY, v); } catch { /* private mode */ }
  };
  return (
    <div className="home">
      <Tabs
        label="Home"
        className="home-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'cards', label: 'Business Cards', ...TAB_ICONS.cards },
          { value: 'minutes', label: 'Meeting Minutes', ...TAB_ICONS.minutes },
        ]}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'cards' ? <Contacts /> : <Minutes />}
      </div>
    </div>
  );
}
