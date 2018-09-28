# How to contribute

We're so happy you're interested in getting involved!
Since this is still a research prototype, there's always lots to do!
We're still fleshing out these guidelines, but here are the basics.

## Relevant repos

https://github.com/schasins/helena The Chrome extension that provides a UI for using programming by demonstration techniques to write Helena web scrapers and automators.

https://github.com/schasins/helena-lang The core Helena language.  It comes with a customized verison of the Ringer record and replay tool and a variety of other functionality that's likely to be useful for any tool that wants to use the Helena language.

https://github.com/schasins/helena-server The server-side and data store content.  Handles the database for tracking shared/saved Helena relations and data scraped by Helena programs.

## Community stuff

Be nice.  Seriously.

## Submitting changes

When you're ready to submit changes, please send GitHub pull requests with clear descriptions of what you've done and lists of the changes.
You can read more about pull requests at https://help.github.com/articles/about-pull-requests/.
Also please make sure you implement only one feature per commit and that you associate a clear log message with each commit.
Feel free to provide one-line messages for small changes, but bigger changes should look like this:

    $ git commit -m "The one-line summary of changes
    > 
    > A paragraph describing exactly what changed, the goals, and the impact."
