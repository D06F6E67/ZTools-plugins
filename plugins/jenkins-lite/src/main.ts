import { createApp } from 'vue'
import './main.css'
import App from './App.vue'

// Dev mode: inject mocks for window.ztools and window.services
if (import.meta.env.DEV) {
  import('./dev/mockZtools').then(({ injectMocks }) => {
    injectMocks()
  })
}

createApp(App).mount('#app')
