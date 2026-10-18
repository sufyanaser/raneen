import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import SessionGate from './SessionGate';
import './style.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><SessionGate/></React.StrictMode>);
if('serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('/ooh/field/sw.js');});
