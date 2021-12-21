import { Toolkit } from 'actions-toolkit'
import { Discussion } from '@octokit/graphql-schema'

export interface FrontMatterAttributes {
  title: string
  labels?: string[] | string
}

export function setOutputs (tools: Toolkit, discussion: Discussion) {
  tools.outputs.number = String(discussion.number)
  tools.outputs.url = discussion.url
}

export function listToArray (list?: string[] | string) {
  if (!list) return []
  return Array.isArray(list) ? list : list.split(', ')
}