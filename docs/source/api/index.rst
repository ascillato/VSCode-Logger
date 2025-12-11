API Reference
=============

The API documentation is generated from Doxygen XML. Ensure ``doxygen Doxyfile`` has been run before building Sphinx so Breathe can locate ``docs/xml``.

.. toctree::
   :maxdepth: 1

.. ifconfig:: have_doxygen

   .. doxygenindex::
      :project: VSCode-Logger

.. ifconfig:: not have_doxygen

   .. note::

      Doxygen XML was not found at ``docs/xml``. Run ``doxygen Doxyfile``
      before building the docs to generate the API reference.
