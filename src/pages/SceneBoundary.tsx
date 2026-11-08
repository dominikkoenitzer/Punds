import { Component, type ReactNode } from 'react'

// A garden that breaks while the page draws it never takes the page with it: the still picture and the written links
// take its place. Errors inside a frame of the scene arrive through the realm's onFail instead (Sando.tsx).
export default class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
