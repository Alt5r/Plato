This is the instructions for Plato

Plato's aim is to secure agent skills
"
I am also working on a mitigation for vulnerabilities in coding agent skills. Because skills are declarative, a malicious skill could potentially execute or embed arbitrary code within a GitHub repository and then spread across other public projects and infrastructure. As those projects are cloned and reused, the cycle could repeat, creating the risk of rapidly self-propagating polymorphic malware.

My current focus is an asymmetric locking system to ensure that only user-authorised skills can enter the skills folder. After that, I plan to address skill injection attacks from the codebase itself.
"

I first want to implement this with skills.sh website

skills.sh is a online agent skills installer 

an example of how skills are installed is below

npx skills add https://github.com/vercel-labs/skills --skill find-skills

the issue here is all the .md files for the skills are in plain text which allows an abitrary skill to make its way into the skills directory in any given coding agent project

Method:

I want to use asymmetric crpytography to secure the agent skills

when the user installs a skill throuugh skills.sh, a cryptographic algorithm should be used to secure the skill in the project directory.

when the coding agent runs and need these agent skills, it shoudl use the public key to unlock the agent skills for intepretation by the agent, this should be done as each prompt is executed at intepreatin time to reduce attack surfaces 

any skills.md files that are in teh agent skills whcih are not encrpyted, meaning secured in our case should not be intepreted by the agent, my initial idea for this is to run the decprytion on the skills with the public key on all the files, wether they look encrpyed or not, then any malicious skills will be corrupted before being intepreted therefore loosing their meaning

UX:

I want this process of installing secured skills to be clean and user friendly,

this could look like 
npx secureskills add https://github.com/vercel-labs/skills --skill find-skills

for generall install of prexisting skills on skills.sh 

there would have to be an initial setup command to setup the two keys public and private


