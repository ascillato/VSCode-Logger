API Reference
=============

The API documentation is generated from Doxygen XML. Ensure ``doxygen Doxyfile`` has been run before building Sphinx so Breathe can locate ``docs/xml``.

.. ifconfig:: have_doxygen

   .. doxygenfile:: configuration.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: deviceTree.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: extension.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: hostEndpoints.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: logPanel.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: logSession.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: passwordManager.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: sshCommandRunner.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: sshTerminal.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: ssh2.d.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: loggerPanel.js
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: sidebarView.js
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: sftpExplorer.js
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: sftpExplorer.ts
      :project: VSCode-Logger
      :members:

   .. doxygenfile:: sidebarView.ts
      :project: VSCode-Logger
      :members:

.. ifconfig:: not have_doxygen

   .. note::

      Doxygen XML was not found at ``docs/xml``. Run ``doxygen Doxyfile``
      before building the docs to generate the API reference.
