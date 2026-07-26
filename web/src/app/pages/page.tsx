import type { Metadata } from 'next'
import PagesComposer from './PagesComposer'

export const metadata: Metadata = {
  title: 'Pages · cartridge.cafe',
  description: 'Build a page of AI-imagined shader frames and content, then publish it to permanent hosting for $10.',
}

export default function PagesRoute() {
  return <PagesComposer />
}
