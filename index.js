import { AppRegistry, LogBox } from 'react-native';
// import { App } from './src/App';
import SpikeScreen from './src/SpikeScreen'; // SPIKE: revert to App when probing is done
import { name as appName } from './app.json';

// Temporary workaround for problem with nested text
// not working currently.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(appName, () => SpikeScreen);
