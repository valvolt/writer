# Writer — Local Story Editor

![Main UI](writer.png)

A small editor for story writers. Because I felt **Scrivener** and **Manuskript** too feature-rich for my taste.

Primarily made to be used offline on your local machine.

## Test it online
- you will need to register a user
- you have a small quota
- the server runs on http. It's not super secure, remember it's just for testing
- try it here: http://46.225.219.90:3000/

## Run it
```
git clone https://github.com/valvolt/writer.git
cd writer
docker compose up --build
```
Open http://localhost:3000/

## Writing your story

Type 'my story' and click Create

### Tiles

Tiles are text sections. Type 'chapter one' and click Add Tile. You can always rename your tile. Click 'Chapter one', the top window will say 'my story - Chapter one'.

You can type your story in the editor window. Text will be rendered on the right panel. The editor supports some markdown elements such as headers, non-numbered lists, italic and bold.

Type '# Chapter One'

Create a second tile named 'chapter two'. Select it by clicking on it.

Type '# Chapter Two'

Click on 'my story'. The rendering pane should say 'Chapter one' then 'Chapter two'.

Drag and drop tile 'Chapter two' on top of tile 'Chapter one'. See how the rendering pane now says 'Chapter two' then 'Chapter one'.

The tile system is how you can break your story in chunk and reorganize them any way you want.

### Highlights

Highlights are sub-pages, notes outside of the story, that you can use to manage anything you need to manage: characters, locations, items, etc.

There are two ways to create a highlight. Let's explore both.

Option 1: contextual menu

- Click on tile Chapter one.
- Below the text 'Chapter One', type Alice meets with Bob in the forrest.
- With the mouse, select 'Alice' and do a right-click. Click 'Make "Alice" a highlight'.
- See how a new Highlight named Alice appeared.
- See how the word 'Alice' is now underscored in the rendering pane of Chapter One.


Option 2: input field

- In the left menu, enter 'Bob' under Highlights and click Add
- See how a new Highlight named Bob appeared.
- See how the word 'Bob' is now underscored in the rendering pane of Chapter One.

- Choose whatever approach you prefer to create a highlight named 'forrest'.

### tags

Tags are namely used to manage highlight.

- Click 'Alice'. In the editor, type #character (no space after the hash sign!)
- Do the same with 'Bob'.
- For 'forrest', use tag #location

Click the tile 'Chapter one', see how the words Alice, Bob and forrest are now rendered.

In the left menu, click tag 'character'. See how 'forrest' disappeared. Press the x to remove the filter. You can filter by any tag you want.

You can also order highlights by alphabetical order, or by number of times they appear in the story.

With these filters, you can see which highlights are overused or underused.

If you remove all occurrences of a highlight, you can delete it (a delete button will appear)

You can also use tags in the text of the tiles. I don't think that's *really* useful, I admit. The story tags will appear on the top banner.

### images

You can upload images anywhere, just right-click and select 'Upload image...'. The image will be rendered on the right pane.

- Upload an image for Alice.
- Click tile 'Chapter one'
- Hover your move over the word 'Alice'. Notice that the image is rendered there.

Images can illustrate your stories, or help you remember who is who and what is what when it comes to highlights.


## On the disk

All content is auto-saved with each keystroke.

You will find folder 'my story' under 'stories'. Browse the files there to retrieve your text in md files and your uploaded images.

Clicking 'Delete' in the UI next to 'my story' and confirming will delete all text and uploaded files from your disk.
