import * as core from '@actions/core'
import { Toolkit } from 'actions-toolkit'
import fm from 'front-matter'
import nunjucks from 'nunjucks'
import { CreateDiscussionPayload, Repository } from "@octokit/graphql-schema";

// @ts-ignore
import dateFilter from 'nunjucks-date-filter'
import { FrontMatterAttributes, listToArray, setOutputs } from './helpers'

function logError(tools: Toolkit, template: string, action: 'creating' | 'updating', err: any) {
  // Log the error message
  const errorMessage = `An error occurred while ${action} the discussion. This might be caused by a malformed discussion title, or a typo in the labels. Check ${template}!`
  tools.log.error(errorMessage)
  tools.log.error(err)

  // The error might have more details
  if (err.errors) tools.log.error(err.errors)

  // Exit with a failing status
  core.setFailed(errorMessage + '\n\n' + err.message)
  return tools.exit.failure()
}

// https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions#creatediscussion
async function createRepoDiscussion(tools: Toolkit, options: { repoNodeId: string; categoryNodeId: string; body: string; title: string; }) {
    tools.log.info("Creating repo discussion...");
    
    const graphqlResponse = await tools.github.graphql<{
      createDiscussion: CreateDiscussionPayload;
    }>(
      `mutation ($repoNodeId: ID!, $categoryNodeId: ID!, $postBody: String!, $postTitle: String!) {
        createDiscussion(input: {repositoryId: $repoNodeId, categoryId: $categoryNodeId, body: $postBody, title: $postTitle}) {
          discussion {
            title
            url
          }
        }
      }`,
      {
        repoNodeId: options.repoNodeId,
        categoryNodeId: options.categoryNodeId,
        postBody: options.body,
        postTitle: options.title,
      }
    );

    tools.log.info("Successfully created the repo discussion.");
    tools.log.debug(`graphqlResponse: ${JSON.stringify(graphqlResponse)}`);
    return graphqlResponse.createDiscussion.discussion;
}

async function getRepoData(tools: Toolkit, options: { repo: string; owner: string }) {
    const repoResponse = await tools.github.repos.get({
      ...options
    });
    if (!repoResponse?.data) throw new Error(`Could not find repo: ${JSON.stringify(options)}`);
    return repoResponse.data;
}

async function getRepoDiscussionCategories(tools: Toolkit, options: { repo: string; owner: string }) {
    tools.log.info(`Getting discussion categories: ${JSON.stringify(options)}`);
    const discussionCategoriesResponse = await tools.github.graphql<{
      repository: Repository;
    }>(
      `query ($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            discussionCategories(first: 10) {
              # type: DiscussionCategoryConnection
              nodes {
                # type: DiscussionCategory
                id
                name
              }
            }
          }
        }`,
      {
        owner: options.owner,
        repo: options.repo,
      }
    );
    tools.log.debug(`discussionCategories: ${JSON.stringify(discussionCategoriesResponse)}`);
    return discussionCategoriesResponse.repository.discussionCategories.nodes;
}

async function getDiscussionCategory(tools: Toolkit, options: { discussionCategoryName: string; repo: string; owner: string }) {
    const repoDiscussionCategories = await getRepoDiscussionCategories(tools, options);
    if (!repoDiscussionCategories || repoDiscussionCategories.length === 0) {
      throw new Error(`Discussions are not enabled on ${options.owner}/${options.repo}`);
    }
    const discussionCategoryMatch = repoDiscussionCategories.find(
      (node) =>
        node?.name.trim().localeCompare(options.discussionCategoryName!, undefined, {
          sensitivity: "accent",
        }) === 0
    );
    if (!discussionCategoryMatch) {
      throw new Error(`Could not find discussion category "${options.discussionCategoryName} in ${options.owner}/${options.repo}".`);
    }
    return discussionCategoryMatch;
  }

export async function createADiscussion (tools: Toolkit) {
  const template = tools.inputs.filename || '.github/DISCUSSION_TEMPLATE.md'

  const env = nunjucks.configure({ autoescape: false })
  env.addFilter('date', dateFilter)

  const templateVariables = {
    ...tools.context,
    repo: tools.context.repo,
    env: process.env,
    date: Date.now()
  }

  // Get the file
  tools.log.debug('Reading from file', template)
  const file = await tools.readFile(template) as string

  // Grab the front matter as JSON
  const { attributes, body } = fm<FrontMatterAttributes>(file)
  tools.log(`Front matter for ${template} is`, attributes)

  const templated = {
    body: env.renderString(body, templateVariables),
    title: env.renderString(attributes.title, templateVariables)
  }
  tools.log.debug('Templates compiled', templated)

  // Create the new issue
  tools.log.info(`Creating new issue ${templated.title}`)
  try {
    const repoData = await getRepoData(tools,{
        ...tools.context.repo
    });
    const discussionCategoryMatch = await getDiscussionCategory(tools, { discussionCategoryName: tools.inputs.category!, ...tools.context.repo });
 
    const newDiscussion = await createRepoDiscussion(tools, {
        ...templated,
        repoNodeId: repoData.node_id,
        categoryNodeId: discussionCategoryMatch.id
    });

    setOutputs(tools, newDiscussion!)
    tools.log.success(`Created issue ${newDiscussion!.title}#${newDiscussion!.number}: ${newDiscussion!.url}`)
  } catch (err: any) {
    return logError(tools, template, 'creating', err)
  }
}