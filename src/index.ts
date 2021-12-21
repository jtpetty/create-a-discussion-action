import { Toolkit } from 'actions-toolkit'
import { createADiscussion } from './action'

Toolkit.run(createADiscussion, {
  secrets: ['GITHUB_TOKEN']
})