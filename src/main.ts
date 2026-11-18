import './styles/main.css';
import { mountWorkbench } from './ui/app';

const appRoot = document.getElementById('app');
if (appRoot) {
  mountWorkbench(appRoot);
}
