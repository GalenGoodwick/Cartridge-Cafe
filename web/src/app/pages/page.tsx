import type { Metadata } from 'next'
import PagesComposer from './PagesComposer'

export const metadata: Metadata = {
  title: 'Shader Pages · cartridge.cafe',
  description: 'Build a mobile-first page where every frame is a shader window your AI imagines into being.',
}

export default function PagesRoute() {
  return <PagesComposer />
}
