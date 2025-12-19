API Reference
=============

The API documentation is generated from Doxygen XML. Ensure ``doxygen Doxyfile`` has been run before building Sphinx so Breathe can locate ``docs/xml``.

.. ifconfig:: have_doxygen

   .. autodoxygenfile:: configuration.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: deviceTree.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: extension.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: hostEndpoints.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: logPanel.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: logSession.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: passwordManager.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: sshCommandRunner.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: sshTerminal.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: ssh2.d.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: loggerPanel.js
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: sidebarView.js
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: sftpExplorer.js
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: sftpExplorer.ts
      :project: VSCode-Logger
      :members:

   .. autodoxygenfile:: sidebarView.ts
      :project: VSCode-Logger
      :members:

.. ifconfig:: not have_doxygen

   .. note::

      Doxygen XML was not found at ``docs/xml``. Run ``doxygen Doxyfile``
      before building the docs to generate the API reference.
