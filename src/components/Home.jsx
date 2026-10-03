import { useState } from 'react';
import Contacts from './Contacts.jsx';
import Minutes from './Minutes.jsx';
import { Tabs } from './ui.jsx';

const TAB_KEY = 'nomiqo.homeTab';
const readTab = () => { try { return sessionStorage.getItem(TAB_KEY) || 'cards'; } catch { return 'cards'; } };

/** The home screen: business cards and meeting minutes, one tab each. Opens on cards after sign-in. */
export default function Home() {
  const [tab, setTabRaw] = useState(readTab);
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
          { value: 'cards', label: 'Business Cards Record' },
          { value: 'minutes', label: 'Meeting Minutes' },
        ]}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'cards' ? <Contacts /> : <Minutes />}
      </div>
    </div>
  );
}
