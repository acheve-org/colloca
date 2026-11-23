import { mount } from 'svelte';
import './lib/styles/tokens.css';
import './lib/styles/base.css';
import './lib/theme.svelte';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
