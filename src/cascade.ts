// The stylesheets of the application's screens, in the order their rules were written against. Every page of the
// application loads them all, so a screen whose code arrives later finds its styles in place, and no rule changes
// rank with the order screens were opened in. A new screen's stylesheet goes at the end of this list.
import './components/Deliveries.css';
import './components/CarrierPickerSheet.css';
import './components/AddParcelSheet.css';
import './components/Settings.css';
import './components/HomeScreenSteps.css';
import './components/NotificationPrompt.css';
import './components/map/map.module.css';
import './components/ParcelMap.css';
import './components/ParcelDetail.css';
import './peek/parcel/Sheets.css';
import './components/Refresh.css';
import './components/Friends.css';
import './components/Arrival.css';
import './peek/parcel/BringAlong.css';
import './peek/landing/CarrierRibbon.css';
import './peek/landing/More.css';
import './peek/landing/Moves.css';
import './peek/landing/Who.css';
import './peek/landing/Landing.css';
import './peek/FrontDoor.css';
import './peek/parcel/Toast.css';
import './peek/ParcelPage.css';
import './peek/parcel/Feedback.css';
